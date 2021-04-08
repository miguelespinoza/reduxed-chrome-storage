import {
  StoreCreator, StoreEnhancer, Action, Reducer, ReducersMapObject,
  Observer, Observable, Unsubscribe,
} from 'redux'
import WrappedStorage from './WrappedStorage';
import { cloneDeep, isEqual, mergeOrReplace } from './utils';
import { ActionExtension, ExtendedStore } from './types/store';

type ReduxReducer = Reducer | ReducersMapObject

export default class ReduxedStorage<
  W extends WrappedStorage<any>, A extends Action
> {
  configureStore: any;
  storage: W;
  reducer: ReduxReducer;
  enhancer?: StoreEnhancer;
  buffLife: number;
  buffStore: ExtendedStore | null;
  state: any;
  lastState: any;
  listeners: (() => void)[];
  inited: boolean;

  constructor({
    configureStore, reducer, storage, bufferLife, initialState, enhancer
  }: {
    configureStore: StoreCreator,
    reducer: ReduxReducer,
    storage: W,
    bufferLife?: number,
    initialState?: any,
    enhancer?: StoreEnhancer
  }) {
    this.configureStore = configureStore;
    this.storage = storage;
    this.reducer = reducer;
    this.enhancer = enhancer;
    this.buffLife = bufferLife? Math.min(Math.max(bufferLife, 0), 2000) : 100;
    this.state = initialState;
    this.buffStore = null;
    this.lastState = null;
    this.listeners = [];
    this.inited = false;
    this.dispatch = this.dispatch.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  init(): Promise<ExtendedStore> {
    if (this.inited)
      return new Promise(resolve => {
        resolve(this as ExtendedStore);
      });
    const initialState = this.state;
    this.state = null;
    const defaultState = this._configureStore().getState();
    // subscribe for changes in chrome.storage
    this.storage.subscribe(data => {
      if (isEqual(data, this.state))
        return;
      this._setState(data);
      for (const fn of this.listeners) {
        fn();
      }
    });
    this.inited = true;
    // return a promise to be resolved when the last state (if any) is restored from chrome.storage
    return new Promise(resolve => {
      // try to restore the last state stored in chrome.storage, if any
      this.storage.load(storedState => {
        let state = storedState?
          mergeOrReplace(defaultState, storedState) : defaultState;
        if (initialState) {
          state = mergeOrReplace(state, initialState);
        }
        this._setState(state);
        if (!isEqual(state, storedState)) {
          this._send2Storage(state);
        }
        resolve(this as ExtendedStore);
      });
    });
  }

  _configureStore(initialState?: any) {
    try {
      return this.configureStore({
        reducer: this.reducer,
        preloadedState: initialState,
        enhancer: this.enhancer
      });
    } catch (err) {
      throw new Error('configureStore() call failed');
    }
  }

  _send2Storage(data: any) {
    try {
      this.storage.save(data);
    } catch (err) {
      throw new Error('Browser storage limit exceeded');
    }
  }

  _setState(data: any) {
    if (data) {
      this.state = cloneDeep(data);
    }
  }

  getState() {
    return this.state;
  }

  subscribe(fn: () => void) {
    typeof fn === 'function' && this.listeners.push(fn);
    return () => {
      if (typeof fn === 'function') {
        this.listeners = this.listeners.filter(v => v !== fn);
      }
    };
  }

  dispatch(action: A | ActionExtension) {
    if (!this.buffStore) {
      // this.buffStore is to be used with sync actions
      this.buffStore = this._configureStore(this.state) as ExtendedStore;
      // this.lastState is shared by both sync and async actions
      this.lastState = this.buffStore.getState();
      setTimeout(() => {
        this.buffStore = null;
      }, this.buffLife);
    }
    // lastStore, holding an extra reference to the last created store, is to be used with async actions (e.g. via Redux Thunk);
    // then when this.buffStore is reset to null this variable should still refer to the same store
    let lastStore: ExtendedStore | null = this.buffStore;
    // set up a one-time state change listener
    const unsubscribe = lastStore.subscribe(() => {
      // if this.buffStore is non-empty, use it for getting the current state,
      // otherwise an async action is implied, so use lastStore instead
      const store = this.buffStore || lastStore;
      const state = store && store.getState();
      // we need a state change to be effective, so the current state should differ from the last saved one
      if (isEqual(state, this.lastState))
        return;
      // send the current state to chrome.storage & update this.lastState
      this._send2Storage(state);
      this.lastState = state;
      // as we already catched the 1st effective state change, we don't need this listener and lastStore anymore,
      // so we unsubscribe the former and reset the latter in order to release the related resources
      unsubscribe();
      lastStore = null;
    });
    return lastStore.dispatch(action);
  }

  replaceReducer(nextReducer: ReduxReducer): ExtendedStore {
    if (typeof nextReducer === 'function') {
      this.reducer = nextReducer;
    }
    return this as ExtendedStore;
  }

  [Symbol.observable](): Observable<any> {
    const getState = this.getState;
    const subscribe = this.subscribe;
    return {
      subscribe(observer: Observer<any>) {
        if (typeof observer !== 'object' || observer === null) {
          throw new TypeError('Expected the observer to be an object.')
        }
        function observeState() {
          const observerAsObserver = observer as Observer<any>
          observerAsObserver.next && observerAsObserver.next(getState());
        }
        observeState();
        const unsubscribe = subscribe(observeState) as Unsubscribe;
        return { unsubscribe };
      },
      [Symbol.observable]() {
        return this
      }
    }
  }
}
