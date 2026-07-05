require("dotenv").config();

const db = require("../src/config/db");

async function run() {
  try {

    console.log("📡 Deleting all posts...");

    // Delete comments first
    const comments = await db.query(`
      DELETE FROM post_comments;
    `);

    console.log(`✅ Deleted ${comments.rowCount} comments.`);

    // Delete likes
    const likes = await db.query(`
      DELETE FROM post_likes;
    `);

    console.log(`✅ Deleted ${likes.rowCount} likes.`);

    // Delete posts
    const posts = await db.query(`
      DELETE FROM posts;
    `);

    console.log(`✅ Deleted ${posts.rowCount} posts.`);

    console.log("🎉 All posts removed successfully.");

    process.exit(0);

  } catch (err) {

    console.error("❌ Failed to delete posts:");
    console.error(err);

    process.exit(1);

  }
}

run();