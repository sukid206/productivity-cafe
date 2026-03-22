#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  DAILY CAFÉ REPORT — Newsletter → Website Pipeline
 * ═══════════════════════════════════════════════════════════════
 *
 *  WHAT THIS DOES:
 *  1. Reads your newsletter HTML file
 *  2. Sends it to Claude API to extract structured article data
 *  3. Saves the JSON to your /data folder
 *  4. Triggers a site rebuild (Vercel/Netlify auto-deploy on git push)
 *
 *  USAGE:
 *    node pipeline.js ./newsletter_mar21_2026.html
 *
 *  SETUP:
 *    npm install @anthropic-ai/sdk
 *    export ANTHROPIC_API_KEY=your_key_here
 *
 *  AUTOMATION:
 *    - Run manually after generating each newsletter
 *    - OR hook into a cron job / GitHub Action
 *    - OR call from the same Claude session that writes the newsletter
 *
 * ═══════════════════════════════════════════════════════════════
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── CONFIG ───
const DATA_DIR = path.join(__dirname, "data");
const SITE_DIR = path.join(__dirname, "site");
const MODEL = "claude-sonnet-4-20250514"; // fast + accurate for extraction
const GIT_AUTO_PUSH = false; // GitHub Action handles commit + push

// ─── EXTRACTION PROMPT ───
const SYSTEM_PROMPT = `You are a content extraction engine for the Daily Café Report newsletter. 

Given the raw HTML of a newsletter issue, extract ALL content into a structured JSON format.

Return ONLY valid JSON (no markdown fences, no preamble). Follow this exact schema:

{
  "meta": {
    "date": "YYYY-MM-DD",
    "day": "Saturday",
    "issue_number": 22,
    "tagline": "The brief summary from the header...",
    "greeting": "The greeting line..."
  },
  "headlines": ["headline 1", "headline 2", ...],
  "articles": [
    {
      "id": "slug-with-date",
      "slug": "url-friendly-slug",
      "title": "Article Title",
      "category": "World Roast|Market Latte|Tech Espresso|Career Move|Side Hustle Spark|Health Shot|Productivity Tip|Mindset Moment|Money Habit",
      "cat_icon": "emoji",
      "featured": true/false,
      "excerpt": "1-2 sentence summary",
      "body": "Full article text (plain text, no HTML)",
      "barista_take": "The humor line from the barista box",
      "date": "YYYY-MM-DD",
      "market_data": [{"name":"...", "value":"...", "mood":"...", "direction":"up|down"}] // only for Market Latte
    }
  ],
  "on_this_day": [
    {"year": 2003, "text": "..."}
  ],
  "meme": {
    "lines": ["line1", "line2"],
    "closer": "closing line"
  },
  "cafe_wins": ["win1", "win2", ...]
}

Rules:
- Extract EVERY section as a separate article
- The first/biggest World Roast story should have "featured": true
- Strip all HTML tags from body text
- Keep the witty tone in barista_take lines
- Slugs should be lowercase, hyphenated, max 5 words
- Market data only appears in the Market Latte / Money Minute article
- If a section has sub-stories (like World Roast with multiple bullet points), combine into one article with full body text`;

// ─── MAIN ───
async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error("Usage: node pipeline.js <newsletter.html>");
    console.error("Example: node pipeline.js ./daily_cafe_mailchimp_mar21_2026.html");
    process.exit(1);
  }

  // 1. Read newsletter HTML
  console.log("☕ Reading newsletter...");
  const html = fs.readFileSync(inputFile, "utf-8");
  console.log(`   → ${html.length.toLocaleString()} characters loaded`);

  // 2. Extract via Claude API
  console.log("🤖 Sending to Claude for extraction...");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract all articles and content from this newsletter HTML into the JSON schema described in your instructions:\n\n${html}`,
      },
    ],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // 3. Parse JSON
  console.log("📦 Parsing extracted data...");
  let data;
  try {
    // Strip markdown fences if present
    const cleaned = rawText.replace(/```json\s*|```\s*/g, "").trim();
    data = JSON.parse(cleaned);
  } catch (err) {
    console.error("❌ Failed to parse JSON from Claude response:");
    console.error(rawText.substring(0, 500));
    process.exit(1);
  }

  // 4. Validate
  const articleCount = data.articles?.length || 0;
  const headlineCount = data.headlines?.length || 0;
  console.log(`   → ${articleCount} articles extracted`);
  console.log(`   → ${headlineCount} headlines found`);
  console.log(`   → Date: ${data.meta?.date}`);
  console.log(`   → Day: ${data.meta?.day}`);

  if (articleCount < 3) {
    console.warn("⚠️  Warning: fewer than 3 articles extracted. Check the output.");
  }

  // 5. Save to data directory
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const dateStr = data.meta?.date || new Date().toISOString().split("T")[0];
  const outFile = path.join(DATA_DIR, `articles-${dateStr}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`💾 Saved: ${outFile}`);

  // Also save as "latest.json" for the site to read
  const latestFile = path.join(DATA_DIR, "latest.json");
  fs.writeFileSync(latestFile, JSON.stringify(data, null, 2));
  console.log(`💾 Saved: ${latestFile}`);

  // 6. Git push (triggers Vercel/Netlify auto-deploy)
  if (GIT_AUTO_PUSH) {
    console.log("🚀 Pushing to git...");
    try {
      execSync(`git add ${DATA_DIR}`, { stdio: "inherit" });
      execSync(
        `git commit -m "☕ Daily Café Report — ${data.meta?.date}"`,
        { stdio: "inherit" }
      );
      execSync("git push", { stdio: "inherit" });
      console.log("✅ Pushed! Site will auto-deploy in ~30 seconds.");
    } catch (err) {
      console.warn("⚠️  Git push failed — you may need to push manually.");
    }
  }

  console.log("\n☕ Pipeline complete!\n");

  // 7. Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Daily Café Report — ${data.meta?.day} · ${data.meta?.date}`);
  console.log(`  ${articleCount} articles · ${headlineCount} headlines`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  data.articles?.forEach((a, i) => {
    console.log(`  ${a.cat_icon} ${a.category}: ${a.title}`);
  });
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("❌ Pipeline error:", err.message);
  process.exit(1);
});
