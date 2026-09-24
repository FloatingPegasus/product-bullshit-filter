# Product Bullshit Filter

A Chrome extension that reads the product page you are on, separates measurable specs from marketing, checks the seller / warranty / returns, and flags suspicious review patterns.

The score is computed locally from those rules. An optional model can rewrite the narrative, but only with lines it can quote from the page, and it cannot change the score.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select the `extension` folder in this project.
4. Open a product page (Amazon, Flipkart, or any listing with specs on the page).
5. Click the extension icon. The report opens in the side panel.
6. Or paste a marketplace URL into the panel and choose **Open**.

Right-click a page or a product link and choose **Filter this product**.

## What the report contains

- Bullshit score, 0–100, with the four things that produced it
- Up to five facts that are actually comparable
- Specs beside the slogan lines
- Seller, warranty, and returns
- Review patterns: polarized stars, copied phrasing, bunched dates, incentivized text
- Gotchas, what would make the buy cleaner, and questions to ask before paying

**Shady sample** and **Clean sample** run the same report on bundled listings, with no page scrape.

**Mark page** outlines slogans, specs, and suspicious review text on the open tab.

## Model (optional)

Open **Model** in the side panel.

- The key stays in `chrome.storage.local` on this profile.
- Page text is sent only when a model pass runs.
- OpenAI, Anthropic, or any OpenAI-compatible base URL (Ollama, Groq, OpenRouter).
- Leave **Run the model automatically** off if you want the local report first.

## Website

```bash
npm start
```

Open `http://127.0.0.1:8787` and paste a listing URL. The server fetches the HTML and runs the same rules as the extension. Samples on the page do not fetch anything.

Stores often refuse a server. When that happens the site says so. Open the listing in Chrome and use the extension, which reads the tab you already have.

## Try the report renderer alone

```bash
npm test
npm run preview
```

Open `http://127.0.0.1:8765/preview/` for the report, or `http://127.0.0.1:8765/demo/listing.html` and filter that tab with the extension.

## Limits

The filter reads text already in the page. Specs that exist only as images, and reviews behind another click, are not included. Slogan detection is tuned for English.
