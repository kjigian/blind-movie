# Blind Pick — Cinema

Pick a movie from your Letterboxd watchlist by synopsis alone. No titles, no bias.

## Deploy to Vercel

### Option 1: Quick Deploy (CLI)
```bash
# Unzip the project
unzip blind-pick.zip
cd blind-pick

# Install Vercel CLI if you haven't
npm i -g vercel

# Deploy
vercel

# For production deployment
vercel --prod
```

### Option 2: GitHub → Vercel
1. Push the `blind-pick` folder contents to a GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Click Deploy — no config needed

### Option 3: Add to existing site
If you want this as a route on your existing Vercel site:
1. Copy `api/watchlist.js` into your project's `api/` folder
2. Copy `public/index.html` to wherever you serve static files (or adapt to your framework)
3. Redeploy

## How It Works

- **`/api/watchlist?username=kjig`** — Serverless function that:
  - Fetches your Letterboxd watchlist RSS feed (server-side, no CORS)
  - Enriches every movie with TMDB data (genres, synopsis, poster, rating, runtime, director)
  - Returns JSON, cached for 5 minutes
  
- **`/index.html`** — Frontend that calls the API and renders the blind pick UI

## Features
- **Always live** — fetches your current watchlist every time (5min cache)
- **Genre filtering** — dynamically built from your actual watchlist
- **Blind browsing** — synopsis, year, rating shown; title hidden until you reveal
- **Tonight's List** — heart movies to build your shortlist for the evening
- **Shuffle & Random** — can't decide? let fate choose
- **Letterboxd links** — jump to the film's LB page after reveal

## Customization

### Default username
In `public/index.html`, find `username: "kjig"` and change it to your username.

### TMDB API key
The included key is a public demo key. For production, get your own free key at
[themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and update it in `api/watchlist.js`.

### Cache duration
The API caches responses for 5 minutes. Change the `s-maxage` value in `vercel.json` and `api/watchlist.js`.
