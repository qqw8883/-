export function parseRuntimeConfig(scope = globalThis) {
  const config = scope.UNDERCOVER_CONFIG || {};
  let firebase = config.firebase;
  if (!firebase && scope.__firebase_config) {
    try { firebase = typeof scope.__firebase_config === 'string' ? JSON.parse(scope.__firebase_config) : scope.__firebase_config; }
    catch { return { error: '联机服务配置格式有误，请联系房主。' }; }
  }
  const complete = firebase && ['apiKey', 'authDomain', 'projectId', 'appId'].every(k => typeof firebase[k] === 'string' && firebase[k].trim());
  if (!complete) return { error: '联机服务尚未配置，暂时无法创建或加入房间。' };
  return {
    firebase,
    appId: config.appId || scope.__app_id || 'undercover-party-app',
    ai: { enabled: config.ai?.enabled === true, model: config.ai?.model || '' },
    appCheckSiteKey: config.appCheckSiteKey || '',
    functionsRegion: config.functionsRegion || 'us-central1',
    emulators: config.emulators === true,
    initialAuthToken: scope.__initial_auth_token || '',
    error: ''
  };
}

export { validateWordPair } from '../functions/lib/validation.mjs';
