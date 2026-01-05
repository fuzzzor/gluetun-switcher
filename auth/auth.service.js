const fs = require('fs').promises;
const path = require('path');
const argon2 = require('argon2');
const security = require('../config/security.config');

const USERS_PATH = path.join(__dirname, '..', 'config', 'security', 'users.json');

async function loadUsers() {
  const raw = await fs.readFile(USERS_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveUsers(data) {
  await fs.writeFile(USERS_PATH, JSON.stringify(data, null, 2));
}

function validatePasswordPolicy(password) {
  const policy = security.passwordPolicy;
  if (password.length < policy.minLength) return false;
  if (policy.requireUppercase && !/[A-Z]/.test(password)) return false;
  if (policy.requireLowercase && !/[a-z]/.test(password)) return false;
  if (policy.requireDigit && !/[0-9]/.test(password)) return false;
  if (policy.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) return false;
  return true;
}

async function ensureAdminPasswordInitialized() {
  const data = await loadUsers();
  const admin = data.users.find(u => u.username === security.admin.username);
  if (!admin.passwordHash) {
    admin.passwordHash = await argon2.hash(security.admin.defaultPassword, { type: argon2.argon2id });
    admin.mustChangePassword = true;
    await saveUsers(data);
  }
}

async function authenticate(username, password) {
  const data = await loadUsers();
  const user = data.users.find(u => u.username === username);
  if (!user) return { success: false };

  // User without password must define one
  if (!user.passwordHash) {
    return { success: true, mustChangePassword: true, noPassword: true };
  }

  if (user.lockedUntil && Date.now() < user.lockedUntil) {
    return { success: false, locked: true };
  }

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    user.failedAttempts++;
    if (user.failedAttempts >= security.passwordPolicy.maxAttempts) {
      user.lockedUntil = Date.now() + security.passwordPolicy.lockTimeSeconds * 1000;
      user.failedAttempts = 0;
    }
    await saveUsers(data);
    return { success: false };
  }

  user.failedAttempts = 0;
  user.lockedUntil = null;
  await saveUsers(data);

  return { success: true, mustChangePassword: user.mustChangePassword };
}

async function changePassword(username, newPassword) {
  if (!validatePasswordPolicy(newPassword)) {
    throw new Error('Password policy violation');
  }
  const data = await loadUsers();
  const user = data.users.find(u => u.username === username);
  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  user.mustChangePassword = false;
  await saveUsers(data);
}

module.exports = {
  ensureAdminPasswordInitialized,
  authenticate,
  changePassword,
  validatePasswordPolicy
};