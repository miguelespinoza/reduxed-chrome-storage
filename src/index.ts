import ReduxedStorage from './ReduxedStorage';
import WrappedChromeStorage from './WrappedChromeStorage';
import WrappedBrowserStorage from './WrappedBrowserStorage';
import { StoreEnhancer, Reducer, ReducersMapObject } from 'redux';
import { ExtendedStore } from './types/store';
import {
  ChromeNamespace, BrowserNamespace, StorageAreaName
} from './types/apis';

type ReduxReducer = Reducer | ReducersMapObject

enum Namespace {
  chrome = 'chrome',
  browser = 'browser'
}
declare const chrome: ChromeNamespace;
declare const browser: BrowserNamespace;

/**
 * ReduxedChromeStorage creator factory.
 * Returns an async store creator that's supposed to replace
 * the Redux Toolkit's configureStore function.
 * Unlike the original configureStore() that immediately returns a store,
 * async store creator returns a Promise to be resolved
 * when the created store is ready
 * @param obj
 * @param obj.configureStore the Redux Toolkit's configureStore function.
 * The only mandatory parameter/property
 * @param obj.namespace string to identify the APIs namespace to be used,
 * either 'chrome' or 'browser'.
 * If this and the next two properties are missing,
 * the chrome namespace is used by default
 * @param obj.chromeNs the chrome namespace within Manifest V2 extension.
 * If this property is supplied, the previous one is ignored
 * @param obj.browserNs the browser namespace within Firefox extension,
 * or the chrome namespace within Manifest V3 chrome extension.
 * You may pass the chrome namespace within Manifest V3 to make this library
 * use Promise-based APIs under the hood.
 * If this property is supplied, the previous two are ignored
 * @param obj.storageArea the name of chrome.storage area to be used,
 * defaults to 'sync'
 * @param obj.storageKey the key to be used for storing/tracking data
 * in chrome.storage, defaults to 'reduxed'
 * @param obj.bufferLife lifetime of the bulk actions buffer (in ms),
 * defaults to 100
 * @returns an async store creator to replace the original configureStore function
 */
export default function reduxedStorageCreatorFactory({
  configureStore,
  namespace, chromeNs, browserNs,
  storageArea, storageKey, bufferLife
}: {
  configureStore: any,
  namespace?: Namespace,
  chromeNs?: ChromeNamespace,
  browserNs?: BrowserNamespace,
  storageArea?: StorageAreaName,
  storageKey?: string,
  bufferLife?: number
}) {
  if (typeof configureStore !== 'function')
    throw new Error(`Missing 'configureStore' parameter/property`);

  const storage = browserNs || namespace === Namespace.browser?
    new WrappedBrowserStorage({
      namespace: browserNs || browser, area: storageArea, key: storageKey
    }) :
    new WrappedChromeStorage({
      namespace: chromeNs || chrome, area: storageArea, key: storageKey
    });
  storage.init();

  function asyncStoreCreator(
    reducer: ReduxReducer,
    enhancer?: StoreEnhancer
  ): Promise<ExtendedStore>
  function asyncStoreCreator(
    reducer: ReduxReducer,
    initialState?: any,
    enhancer?: StoreEnhancer
  ): Promise<ExtendedStore>
  function asyncStoreCreator(
    reducer: ReduxReducer,
    initialState?: any | StoreEnhancer,
    enhancer?: StoreEnhancer
  ): Promise<ExtendedStore> {
    if (typeof reducer !== 'function')
      throw new Error(`Missing 'reducer' parameter`);
    if (typeof initialState === 'function' && typeof enhancer === 'function')
      throw new Error(`Multiple 'enhancer' parameters unallowed`);
    if (typeof initialState === 'function' && typeof enhancer === 'undefined') {
      enhancer = initialState as StoreEnhancer
      initialState = undefined
    }
    const store = new ReduxedStorage({
      configureStore, storage, bufferLife,
      reducer, initialState, enhancer
    });
    return store.init();
  }

  return asyncStoreCreator;
}
