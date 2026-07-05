const db = require('../config/db');

const User = {
  async create({ username, email, passwordHash, displayName }) {
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, avatar_url, coin_balance, earnings_balance, role, created_at`,
      [username, email, passwordHash, displayName || username]
    );
    return rows[0];
  },

  async findByEmail(email) {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0];
  },

  async findByUsername(username) {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    return rows[0];
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT id, username, email, display_name, avatar_url, bio, gender, date_of_birth,
              country, interests, coin_balance, earnings_balance, is_verified, role,
              status, last_seen_at, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    return rows[0];
  },

  async updateProfile(id, fields) {
    const allowed = ['display_name', 'bio', 'gender', 'date_of_birth', 'country', 'interests', 'avatar_url'];
    const sets = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) return this.findById(id);
    values.push(id);
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, username, email, display_name, bio, avatar_url, gender, date_of_birth, country, interests, coin_balance, earnings_balance, is_verified, role`,
      values
    );
    return rows[0];
  },

  async discover({ excludeUserId, interests, country, limit = 20, offset = 0 }) {
    const conditions = ['id != $1', "status = 'active'"];
    const values = [excludeUserId];
    let i = 2;

    if (country) {
      conditions.push(`country = $${i++}`);
      values.push(country);
    }
    if (interests && interests.length) {
      conditions.push(`interests && $${i++}`);
      values.push(interests);
    }

    values.push(limit, offset);
    const { rows } = await db.query(
      `SELECT id, username, display_name, avatar_url, bio, country, interests, is_verified
       FROM users
       WHERE ${conditions.join(' AND ')}
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT $${i++} OFFSET $${i}`,
      values
    );
    return rows;
  },

  async findOrCreateOAuthUser({ provider, providerUserId, email, displayName, avatarUrl }) {
    const { rows: existing } = await db.query(
      `SELECT u.* FROM users u
       JOIN oauth_accounts o ON o.user_id = u.id
       WHERE o.provider = $1 AND o.provider_user_id = $2`,
      [provider, providerUserId]
    );
    if (existing[0]) return existing[0];

    let user = email ? await this.findByEmail(email) : null;

    if (!user) {
      const baseUsername = (email ? email.split('@')[0] : `${provider}_${providerUserId}`).replace(/[^a-zA-Z0-9_]/g, '');
      let username = baseUsername;
      let suffix = 0;
      // ensure unique username
      while (await this.findByUsername(username)) {
        suffix += 1;
        username = `${baseUsername}${suffix}`;
      }
      const { rows } = await db.query(
        `INSERT INTO users (username, email, display_name, avatar_url)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [username, email || `${username}@no-email.vconnect`, displayName || username, avatarUrl]
      );
      user = rows[0];
    }

    await db.query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [user.id, provider, providerUserId]
    );

    return user;
  },

  async touchLastSeen(id) {
    await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [id]);
  },
};

module.exports = User;