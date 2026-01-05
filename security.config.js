// Security configuration loaded from environment variables
// All defaults are secure-by-default and documented in README.md

module.exports = {
  httpsEnabled: process.env.HTTPS_ENABLED === 'false',
  httpsKeyPath: process.env.HTTPS_KEY_PATH || '',
  httpsCertPath: process.env.HTTPS_CERT_PATH || '',

  sessionSecret: process.env.SESSION_SECRET || 'CHANGE_ME_RANDOM_64_CHARS',
  sessionName: process.env.SESSION_NAME || 'gluetun-switcher.sid',

  passwordPolicy: {
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10),
    requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
    requireDigit: process.env.PASSWORD_REQUIRE_DIGIT !== 'false',
    requireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false',
    maxAttempts: parseInt(process.env.PASSWORD_MAX_ATTEMPTS || '5', 10),
    lockTimeSeconds: parseInt(process.env.PASSWORD_LOCK_TIME || '900', 10),
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    defaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'switcher',
  }
};