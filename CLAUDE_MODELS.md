# Claude Model Configuration

## Current Setup

The bot now uses an **environment variable** for the Claude model, so you can change it without editing code!

## How to Change the Model

### On Render (Production):
1. Go to Render Dashboard → Your Service
2. Click "Environment" tab
3. Add or update: `ANTHROPIC_MODEL=claude-3-haiku-20240307`
4. Click "Save Changes" (auto-redeploys)

### Locally (.env file):
```bash
ANTHROPIC_MODEL=claude-3-haiku-20240307
```

## Recommended Stable Models

### ✅ **claude-3-haiku-20240307** (CURRENT - RECOMMENDED)
- **Speed:** ⚡⚡⚡ Very Fast (1-2 seconds)
- **Cost:** 💰 Cheapest ($0.25 per million tokens)
- **Quality:** Good for customer service
- **Stability:** ✅ Long-term stable model
- **Best for:** SMS bots, quick responses, high volume

### 🔵 **claude-3-sonnet-20240229**
- **Speed:** ⚡⚡ Medium (2-4 seconds)
- **Cost:** 💰💰 Moderate ($3 per million tokens)
- **Quality:** Excellent, more thoughtful responses
- **Stability:** ✅ Long-term stable model
- **Best for:** Complex queries, better reasoning

### 🟣 **claude-3-opus-20240229**
- **Speed:** ⚡ Slower (4-8 seconds)
- **Cost:** 💰💰💰 Most expensive ($15 per million tokens)
- **Quality:** Best available, deepest reasoning
- **Stability:** ✅ Long-term stable model
- **Best for:** Only if you need the absolute best quality

## ⚠️ Models to AVOID

❌ **claude-3-5-sonnet-20241022** - Does NOT exist
❌ **claude-3-5-sonnet-20240620** - May not work with all API keys
❌ Any model with "latest" - Not guaranteed to stay available

## When to Update

You should ONLY update the model if:
1. You want better quality responses (upgrade to Sonnet or Opus)
2. Your current model stops working (rare)
3. Anthropic explicitly deprecates the model (they announce this months in advance)

## Model Version Format

Anthropic uses this format: `claude-{version}-{tier}-{release-date}`

Examples:
- `claude-3-haiku-20240307` = Claude 3, Haiku tier, released March 7, 2024
- `claude-3-sonnet-20240229` = Claude 3, Sonnet tier, released Feb 29, 2024

The **release date** ensures stability - these specific versions won't change.

## Testing New Models

Before changing in production:
```bash
# Test locally first
ANTHROPIC_MODEL=claude-3-sonnet-20240229 npm start

# Send test SMS to verify it works
```

Then update Render environment variable once confirmed.
