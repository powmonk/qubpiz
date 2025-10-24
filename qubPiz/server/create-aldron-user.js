// Script to create the aldron admin user
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function createAldronUser() {
  try {
    // Check if aldron user already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      ['aldron']
    );

    if (existing.rows.length > 0) {
      console.log('User "aldron" already exists. Updating password...');

      // Update password
      const password = 'admin123'; // Default password, should be changed
      const passwordHash = await bcrypt.hash(password, 10);

      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE username = $2',
        [passwordHash, 'aldron']
      );

      console.log('✅ Password updated for user "aldron"');
      console.log('Username: aldron');
      console.log('Password: admin123');
    } else {
      console.log('Creating user "aldron"...');

      // Create new user
      const password = 'admin123'; // Default password, should be changed
      const passwordHash = await bcrypt.hash(password, 10);

      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        ['aldron', passwordHash]
      );

      console.log('✅ User "aldron" created successfully!');
      console.log('Username: aldron');
      console.log('Password: admin123');
      console.log('⚠️  Please change this password after first login');
    }

    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    await pool.end();
    process.exit(1);
  }
}

createAldronUser();
