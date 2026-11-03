import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { parseRuntimeConfig } from './config.mjs';

export const runtimeConfig = parseRuntimeConfig();
export let setupError = runtimeConfig.error;
export let app = null;
export let auth = null;
export let db = null;
export const appId = runtimeConfig.appId || 'undercover-party-app';
let callable = null;
try {
  if (!setupError) {
    app = initializeApp(runtimeConfig.firebase);
    if (runtimeConfig.appCheckSiteKey) initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(runtimeConfig.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
    auth = getAuth(app);
    db = getFirestore(app);
    const functions = getFunctions(app, runtimeConfig.functionsRegion);
    if (runtimeConfig.emulators && ['localhost','127.0.0.1'].includes(globalThis.location?.hostname)) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true});
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    callable = httpsCallable(functions, 'roomAction', {timeout:65000});
  }
} catch {
  setupError = '联机服务初始化失败，请检查项目配置。';
}

export async function roomAction(data) {
  if (!callable) throw new Error(setupError || '联机服务尚未连接。');
  const result = await callable({...data, appId});
  return result.data;
}
