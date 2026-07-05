const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

const db = require('../config/db');
const User = require("../models/user");

const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../utils/token');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

/**
 * Build auth response and persist refresh token
 */
async function buildAuthResponse(user, req) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role || 'user',
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Store refresh token for session tracking
  await db.query(
    `
    INSERT INTO user_sessions
    (
      user_id,
      refresh_token,
      device_name,
      ip_address,
      expires_at
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      NOW() + INTERVAL '30 days'
    )
    `,
    [
      user.id,
      refreshToken,
      req.headers['user-agent'] || null,
      req.ip || null,
    ]
  );

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      coinBalance: user.coin_balance,
      earningsBalance: user.earnings_balance,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
}

const AuthController = {
  // POST /api/auth/register
  // { username, email, password, displayName }
  async register(req, res, next) {
    try {
      const {
        username,
        email,
        password,
        displayName,
      } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          message:
            'username, email and password are required',
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message:
            'Password must be at least 8 characters',
        });
      }

      const existingEmail =
        await User.findByEmail(email);

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered',
        });
      }

      const existingUsername =
        await User.findByUsername(username);

      if (existingUsername) {
        return res.status(409).json({
          success: false,
          message: 'Username already taken',
        });
      }

      const passwordHash = await bcrypt.hash(
        password,
        12
      );

      const user = await User.create({
        username,
        email,
        passwordHash,
        displayName,
      });

      const authData = await buildAuthResponse(
        user,
        req
      );

      return res.status(201).json({
        success: true,
        data: authData,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/auth/login
  // { email, password }
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message:
            'email and password are required',
        });
      }

      const user = await User.findByEmail(email);

      if (!user || !user.password_hash) {
        return res.status(401).json({
          success: false,
          message:
            'Invalid email or password',
        });
      }

      const valid = await bcrypt.compare(
        password,
        user.password_hash
      );

      if (!valid) {
        return res.status(401).json({
          success: false,
          message:
            'Invalid email or password',
        });
      }

      if (user.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: `Account is ${user.status}`,
        });
      }

      await User.touchLastSeen(user.id);

      const authData = await buildAuthResponse(
        user,
        req
      );

      return res.json({
        success: true,
        data: authData,
      });
    } catch (err) {
      next(err);
    }
  },


  


    // POST /api/auth/refresh
  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'refreshToken is required',
        });
      }

      let payload;

      try {
        payload = verifyRefreshToken(
          refreshToken
        );
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token',
        });
      }

      const { rows } = await db.query(
        `
        SELECT *
        FROM user_sessions
        WHERE refresh_token = $1
        AND expires_at > NOW()
        `,
        [refreshToken]
      );

      const session = rows[0];

      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Session expired',
        });
      }

      const user = await User.findById(
        payload.sub
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
      };

      const accessToken =
        signAccessToken(tokenPayload);

      const newRefreshToken =
        signRefreshToken(tokenPayload);

      await db.query(
        `
        UPDATE user_sessions
        SET refresh_token = $1,
            expires_at = NOW() + INTERVAL '30 days'
        WHERE id = $2
        `,
        [
          newRefreshToken,
          session.id,
        ]
      );

      return res.json({
        success: true,
        data: {
          accessToken,
          refreshToken:
            newRefreshToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/auth/logout
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'refreshToken is required',
        });
      }

      await db.query(
        `
        DELETE FROM user_sessions
        WHERE refresh_token = $1
        `,
        [refreshToken]
      );

      return res.json({
        success: true,
        message:
          'Logged out successfully',
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/auth/logout-all
  async logoutAll(req, res, next) {
    try {
      await db.query(
        `
        DELETE FROM user_sessions
        WHERE user_id = $1
        `,
        [req.user.id]
      );

      return res.json({
        success: true,
        message:
          'Logged out from all devices',
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/auth/google
  // { idToken }
  async googleLogin(req, res, next) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({
          success: false,
          message: 'idToken is required',
        });
      }

      const ticket =
        await googleClient.verifyIdToken({
          idToken,
          audience:
            process.env.GOOGLE_CLIENT_ID,
        });

      const payload =
        ticket.getPayload();

      const user =
        await User.findOrCreateOAuthUser({
          provider: 'google',
          providerUserId: payload.sub,
          email: payload.email,
          displayName: payload.name,
          avatarUrl: payload.picture,
        });

      await User.touchLastSeen(user.id);

      const authData =
        await buildAuthResponse(
          user,
          req
        );

      return res.json({
        success: true,
        data: authData,
      });
    } catch (err) {
      err.status = 401;
      err.message =
        'Google authentication failed';

      next(err);
    }
  },

  // POST /api/auth/facebook
  // { accessToken }
  async facebookLogin(req, res, next) {
    try {
      const { accessToken } = req.body;

      if (!accessToken) {
        return res.status(400).json({
          success: false,
          message:
            'accessToken is required',
        });
      }

      const { data } = await axios.get(
        'https://graph.facebook.com/me',
        {
          params: {
            fields:
              'id,name,email,picture.type(large)',
            access_token: accessToken,
          },
        }
      );

      const user =
        await User.findOrCreateOAuthUser({
          provider: 'facebook',
          providerUserId: data.id,
          email: data.email,
          displayName: data.name,
          avatarUrl:
            data.picture?.data?.url,
        });

      await User.touchLastSeen(user.id);

      const authData =
        await buildAuthResponse(
          user,
          req
        );

      return res.json({
        success: true,
        data: authData,
      });
    } catch (err) {
      err.status = 401;
      err.message =
        'Facebook authentication failed';

      next(err);
    }
  },

  // GET /api/auth/me
async me(req, res, next) {
  try {

    const user =
      await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const { rows:[counts] } =
      await db.query(
        `
        SELECT
          (
            SELECT COUNT(*)
            FROM followers
            WHERE following_id = $1
          )::int AS followers_count,

          (
            SELECT COUNT(*)
            FROM followers
            WHERE follower_id = $1
          )::int AS following_count,

          (
            SELECT COUNT(*)
            FROM gift_transactions
            WHERE receiver_id = $1
          )::int AS gifts_received_count,

          (
            SELECT COUNT(*)
            FROM live_rooms
            WHERE host_id = $1
          )::int AS stream_count
        `,
        [user.id]
      );

    return res.json({
      success: true,
      data: {
        ...user,
        ...counts
      }
    });

  } catch (err) {
    next(err);
  }
}
};

module.exports = AuthController;