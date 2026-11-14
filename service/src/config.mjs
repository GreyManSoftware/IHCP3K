const permissions = new Set(['send', 'claim', 'status', 'wake', 'admin']);
const name = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Validate before opening the database or listening. Never include values in errors.
export function validateConfig(config, mode) {
  const fail = () => { throw Error('INVALID_SERVICE_CONFIG'); };
  if (!['synthetic', 'live'].includes(mode)) fail();
  if (!Array.isArray(config?.recipients) || !config.recipients.length ||
      new Set(config.recipients).size !== config.recipients.length ||
      config.recipients.some(r => typeof r !== 'string' || !name.test(r))) fail();
  if (mode === 'synthetic' && (config.synthetic !== true || config.recipients.some(r => !r.startsWith('test-')))) fail();
  if (mode === 'live' && (config.mode !== 'live' || config.synthetic !== false)) fail();
  if (!Array.isArray(config.principals) || !config.principals.length) fail();
  const ids = new Set(), tokens = new Set();
  for (const p of config.principals) {
    if (!p || typeof p.id !== 'string' || !name.test(p.id) || ids.has(p.id) || typeof p.token !== 'string' || tokens.has(p.token) || p.token.length < 24) fail();
    if (mode === 'live' && (!/^[A-Za-z0-9_-]{43,}$/.test(p.token) || /synthetic|not-a-secret/i.test(p.token))) fail();
    ids.add(p.id); tokens.add(p.token);
    if (!Array.isArray(p.permissions) || !p.permissions.length || new Set(p.permissions).size !== p.permissions.length || p.permissions.some(x => !permissions.has(x))) fail();
    if (mode === 'live' && !p.scopes) fail();
    for (const permission of p.permissions) {
      const scope = mode === 'live' ? p.scopes[permission] : p.scopes?.[permission] ?? p.recipients;
      if (!Array.isArray(scope) || !scope.length || scope.some(r => !config.recipients.includes(r))) fail();
    }
    if (p.scopes && Object.keys(p.scopes).some(x => !p.permissions.includes(x))) fail();
  }
  return config;
}
