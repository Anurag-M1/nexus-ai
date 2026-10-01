// ==========================================
// NexusAI — URL Content Scraper
// ==========================================

import * as cheerio from 'cheerio';

/**
 * Scrape text content from a URL.
 * Extracts the main article text, stripping navigation, ads, scripts, etc.
 * @param {string} url - URL to scrape
 * @returns {Promise<string>} - Extracted text content
 */
export async function scrapeUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NexusAI Research Bot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000), // 15 second timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  // Handle plain text
  if (contentType.includes('text/plain')) {
    return await response.text();
  }

  // Handle JSON
  if (contentType.includes('application/json')) {
    const json = await response.json();
    return JSON.stringify(json, null, 2);
  }

  // Handle HTML
  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, iframe, noscript, .sidebar, .nav, .menu, .ad, .advertisement, .social-share, .comments, .cookie-banner, [role="navigation"], [role="banner"], [role="complementary"]').remove();

  // Try to find the main content area
  const mainSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.post-body',
    '.article-body',
  ];

  let mainContent = '';
  
  for (const selector of mainSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      mainContent = el.first().text();
      break;
    }
  }

  // Fallback to body
  if (!mainContent || mainContent.trim().length < 100) {
    mainContent = $('body').text();
  }

  // Clean up whitespace
  mainContent = mainContent
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // Get page title
  const pageTitle = $('title').text().trim() || $('h1').first().text().trim();

  // Get meta description
  const metaDesc = $('meta[name="description"]').attr('content') || '';

  // Compose final content
  let result = '';
  if (pageTitle) result += `Title: ${pageTitle}\n\n`;
  if (metaDesc) result += `Description: ${metaDesc}\n\n`;
  result += mainContent;

  // Limit output length
  if (result.length > 15000) {
    result = result.substring(0, 15000) + '\n\n[Content truncated at 15,000 characters]';
  }

  return result;
}
