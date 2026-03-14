# Blind Pick — Cinema

Pick a movie from your Letterboxd watchlist by synopsis alone. No titles, no bias.

---

## Project Structure

```
blind-pick/
├── api/
│   └── watchlist.js      ← Serverless function (fetches RSS + TMDB)
├── public/
│   └── index.html        ← Frontend (single file, no framework)
├── package.json
├── vercel.json
└── README.md
```

---

## Deploy to Vercel

### Option 1: CLI
```bash
cd blind-pick
npm i -g vercel    # if you don't have it
vercel             # follow prompts
vercel --prod      # production deploy
```

### Option 2: GitHub → Vercel
1. Push the `blind-pick` folder to a GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo → Deploy (no config needed)

### Option 3: Add to your existing site
1. Copy `api/watchlist.js` into your project's `api/` folder
2. Copy `public/index.html` to your static files or adapt to your framework
3. Redeploy

---

## How It Works

- `GET /api/watchlist?username=kjig` — serverless function that:
  - Fetches Letterboxd watchlist RSS (server-side, no CORS)
  - Enriches every movie via TMDB (genres, synopsis, poster, rating, runtime, director)
  - Returns JSON, cached 5 minutes
- `index.html` — vanilla JS frontend, calls the API, renders blind pick UI

---

## Features

- **Always live** — pulls your current watchlist each visit (5min cache)
- **Genre filtering** — genres built dynamically from your actual films
- **Blind browsing** — synopsis + year + rating shown, title hidden until reveal
- **Tonight's List** — heart movies to build a shortlist
- **Shuffle & Random** — randomize order or pick one film for you
- **Letterboxd links** — jump to LB page after reveal
- **Director + runtime** — shown on reveal via TMDB credits

---

## Files

### `package.json`

```json
{
  "name": "blind-pick",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vercel dev"
  }
}
```

### `vercel.json`

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "s-maxage=300, stale-while-revalidate=600" }
      ]
    }
  ]
}
```

### `api/watchlist.js`

```js
const TMDB_KEY = "2dca580c2a14b55200e784d157207b4d";

export default async function handler(req, res) {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Missing username parameter" });
  }

  try {
    const rssUrl = `https://letterboxd.com/${encodeURIComponent(username)}/watchlist/rss/`;
    const rssRes = await fetch(rssUrl, {
      headers: { "User-Agent": "BlindPick/1.0" },
    });

    if (!rssRes.ok) {
      return res.status(404).json({
        error: `Could not fetch watchlist for "${username}". Make sure the username is correct and the watchlist is public.`,
      });
    }

    const xml = await rssRes.text();
    const movies = parseRSS(xml);

    if (movies.length === 0) {
      return res.status(404).json({
        error: `No movies found in ${username}'s watchlist. It may be empty or private.`,
      });
    }

    const enriched = [];
    const batchSize = 5;

    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(enrichWithTMDB));
      enriched.push(...results);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      username,
      count: enriched.length,
      movies: enriched,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error: " + err.message });
  }
}

function parseRSS(xml) {
  const movies = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, "title") || "";
    const link = extractTag(itemXml, "link") || "";
    const description = extractTag(itemXml, "description") || "";

    const yearMatch = title.match(/\((\d{4})\)\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const cleanTitle = yearMatch ? title.replace(/\s*\(\d{4}\)\s*$/, "").trim() : title.trim();

    const imgMatch = description.match(/src=["']([^"']+)["']/);
    const lbPoster = imgMatch ? imgMatch[1] : null;

    const descText = description
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .trim();

    if (cleanTitle) {
      movies.push({
        title: cleanTitle,
        year,
        letterboxdUrl: link,
        lbPoster,
        lbDescription: descText || null,
      });
    }
  }

  return movies;
}

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(regex);
  return m ? m[1].trim() : null;
}

async function enrichWithTMDB(movie) {
  try {
    const query = encodeURIComponent(movie.title);
    const yearParam = movie.year ? `&year=${movie.year}` : "";
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearParam}`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      const r = searchData.results[0];

      const detailRes = await fetch(
        `https://api.themoviedb.org/3/movie/${r.id}?api_key=${TMDB_KEY}&append_to_response=credits`
      );
      const detail = await detailRes.json();

      const director = detail.credits?.crew?.find((c) => c.job === "Director")?.name || null;

      return {
        title: movie.title,
        year: movie.year || (r.release_date ? parseInt(r.release_date) : null),
        synopsis: r.overview || movie.lbDescription || "",
        rating: r.vote_average ? parseFloat(r.vote_average.toFixed(1)) : null,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : movie.lbPoster,
        backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w780${r.backdrop_path}` : null,
        genres: detail.genres ? detail.genres.map((g) => g.name) : [],
        runtime: detail.runtime || null,
        director,
        tmdbId: r.id,
        letterboxdUrl: movie.letterboxdUrl,
      };
    }
  } catch (e) {
    console.error(`TMDB enrichment failed for "${movie.title}":`, e.message);
  }

  return {
    title: movie.title,
    year: movie.year,
    synopsis: movie.lbDescription || "",
    rating: null,
    poster: movie.lbPoster,
    backdrop: null,
    genres: [],
    runtime: null,
    director: null,
    tmdbId: null,
    letterboxdUrl: movie.letterboxdUrl,
  };
}
```

### `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blind Pick — Cinema</title>
  <meta name="description" content="Pick a movie from your Letterboxd watchlist by synopsis alone. No titles, no bias." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg: #08080b;
      --surface: #111116;
      --surface2: #1a1a22;
      --text: #e8e6e1;
      --text2: #999;
      --text3: #555;
      --border: rgba(255,255,255,0.05);
      --accent: #7209B7;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'DM Sans', -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
    }

    #ambient {
      position: fixed; inset: 0; z-index: 0;
      background: radial-gradient(ellipse at 30% 0%, #14142a 0%, transparent 50%),
                  radial-gradient(ellipse at 70% 100%, #1a0a1e 0%, transparent 50%),
                  var(--bg);
      transition: background 0.8s ease;
    }

    .container { position: relative; z-index: 2; max-width: 1120px; margin: 0 auto; padding: 0 20px; }

    header {
      padding: 22px 0 18px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap; gap: 10px;
    }
    .logo { cursor: pointer; display: flex; align-items: baseline; gap: 10px; text-decoration: none; }
    .logo h1 {
      font-family: 'Playfair Display', serif;
      font-size: 24px; font-weight: 900; letter-spacing: -0.5px;
      background: linear-gradient(135deg, #e8e6e1, #a8a6a1);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .logo span { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--text3); font-weight: 300; }
    .header-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

    .pill {
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      color: var(--text2); padding: 7px 14px; border-radius: 6px;
      cursor: pointer; font-size: 12px; font-family: 'DM Sans', sans-serif;
      transition: all 0.2s; white-space: nowrap;
    }
    .pill:hover { background: rgba(255,255,255,0.08); color: var(--text); }
    .pill.active { background: rgba(255,255,255,0.08); color: var(--text); }

    .landing { padding-top: 80px; max-width: 480px; margin: 0 auto; text-align: center; }
    .landing-icon { font-size: 48px; margin-bottom: 20px; }
    .landing h2 {
      font-family: 'Playfair Display', serif;
      font-size: min(36px, 8vw); font-weight: 400; font-style: italic;
      line-height: 1.2; margin-bottom: 12px;
    }
    .landing p.sub { color: var(--text3); font-size: 14px; font-weight: 300; line-height: 1.6; margin-bottom: 36px; }
    .input-row { display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap; }
    .input-wrap { position: relative; flex: 1; min-width: 220px; max-width: 300px; }
    .input-wrap label {
      position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
      color: var(--text3); font-size: 14px; pointer-events: none;
    }
    .input-wrap input {
      width: 100%; background: var(--surface); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px; padding: 14px 16px 14px 128px;
      color: var(--text); font-size: 15px; font-family: 'DM Sans', sans-serif;
      transition: border-color 0.2s;
    }
    .input-wrap input:focus { border-color: rgba(255,255,255,0.2); outline: none; }
    .fetch-btn {
      background: linear-gradient(135deg, #7209B7, #3A0CA3);
      border: none; color: var(--text); padding: 14px 24px; border-radius: 10px;
      cursor: pointer; font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif;
      letter-spacing: 0.5px; transition: all 0.2s; white-space: nowrap;
    }
    .fetch-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
    .fetch-btn:disabled { opacity: 0.5; cursor: wait; transform: none; filter: none; }

    .progress { margin-top: 32px; animation: fadeUp 0.3s ease; }
    .progress-bar { height: 3px; background: rgba(255,255,255,0.04); border-radius: 2px; overflow: hidden; max-width: 300px; margin: 0 auto 12px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #7209B7, #3A0CA3); border-radius: 2px; transition: width 0.3s; }
    .progress p { color: var(--text3); font-size: 13px; font-weight: 300; }

    .error { margin-top: 24px; padding: 14px 20px; background: rgba(230,57,70,0.06); border: 1px solid rgba(230,57,70,0.2); border-radius: 10px; color: #E63946; font-size: 13px; }

    .genres-view { padding-top: 48px; }
    .genres-header { text-align: center; margin-bottom: 36px; }
    .genres-header .meta { color: var(--text3); font-size: 13px; font-weight: 300; letter-spacing: 1px; margin-bottom: 12px; }
    .genres-header h2 { font-family: 'Playfair Display', serif; font-size: min(36px, 8vw); font-weight: 400; font-style: italic; }
    .show-all-btn {
      display: inline-block; margin-bottom: 20px;
      background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
      padding: 14px 32px; cursor: pointer; color: #c8c6c1;
      font-size: 15px; font-weight: 500; font-family: 'DM Sans', sans-serif;
      transition: all 0.2s;
    }
    .show-all-btn:hover { background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04)); border-color: rgba(255,255,255,0.15); }
    .genre-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px; max-width: 760px; margin: 0 auto;
    }
    .genre-card {
      border-radius: 10px; padding: 20px 14px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 7px;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1); border: 1px solid transparent;
    }
    .genre-card:hover { transform: translateY(-3px); }
    .genre-card .emoji { font-size: 24px; }
    .genre-card .name { font-size: 13px; font-weight: 500; color: #c8c6c1; }
    .genre-card .count { font-size: 11px; color: var(--text3); font-weight: 300; }

    .browse-view { padding-top: 24px; }
    .breadcrumb { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
    .breadcrumb .back { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 13px; font-family: 'DM Sans', sans-serif; padding: 4px 0; }
    .breadcrumb .back:hover { color: var(--text2); }
    .breadcrumb .sep { color: #333; }
    .breadcrumb .current { font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
    .breadcrumb .num { color: #444; font-size: 12px; font-weight: 300; margin-left: 4px; }

    .movie-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
    }

    .movie-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; overflow: hidden;
      transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
    }
    .movie-card.revealed { border-color: rgba(255,255,255,0.1); }
    .movie-card .poster-area { position: relative; overflow: hidden; }
    .movie-card .poster-area img {
      width: 100%; height: 100%; object-fit: cover;
      transition: filter 0.6s ease, height 0.4s ease;
    }
    .movie-card .poster-area .gradient {
      position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
      background: linear-gradient(transparent, var(--surface));
    }
    .movie-card .mystery-num {
      position: absolute; top: 10px; right: 14px;
      font-family: 'Playfair Display', serif; font-size: 44px; font-weight: 900;
      color: rgba(255,255,255,0.04); line-height: 1;
    }
    .movie-card .body { padding: 14px 18px 18px; }
    .movie-card .title-area { margin-bottom: 8px; }
    .movie-card h3 {
      font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; margin-bottom: 3px;
    }
    .movie-card .meta-line { font-size: 12px; color: #777; font-weight: 300; }
    .movie-card .mystery-title { font-family: 'Playfair Display', serif; font-size: 15px; font-style: italic; color: var(--text3); margin-bottom: 3px; }
    .movie-card .mystery-meta { font-size: 12px; color: #444; }

    .genre-pills { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
    .genre-pill {
      font-size: 10px; padding: 2px 7px; border-radius: 20px;
      font-weight: 500; letter-spacing: 0.3px;
    }

    .movie-card .synopsis {
      font-size: 13px; line-height: 1.7; color: var(--text2); font-weight: 300;
      margin-bottom: 16px;
      display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
    }

    .card-actions { display: flex; gap: 7px; }
    .reveal-btn, .heart-btn, .lb-link {
      border-radius: 7px; cursor: pointer; font-size: 12px;
      font-family: 'DM Sans', sans-serif; transition: all 0.2s;
      display: flex; align-items: center; justify-content: center;
    }
    .reveal-btn { flex: 1; padding: 9px 14px; font-weight: 500; letter-spacing: 0.3px; }
    .heart-btn { padding: 9px 13px; font-size: 14px; }
    .lb-link {
      padding: 9px 11px; font-size: 11px; text-decoration: none; font-weight: 600;
      background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text3);
    }
    .lb-link:hover { background: rgba(255,255,255,0.08); color: var(--text2); }

    .tonight-view { padding-top: 24px; }
    .tonight-view h2 { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 400; font-style: italic; margin-bottom: 24px; }
    .tonight-empty { text-align: center; padding: 60px 20px; color: #444; }
    .tonight-empty .icon { font-size: 40px; margin-bottom: 12px; }
    .tonight-empty h3 { font-family: 'Playfair Display', serif; font-size: 17px; font-style: italic; margin-bottom: 6px; }
    .tonight-empty p { font-size: 13px; color: var(--text3); font-weight: 300; }
    .tonight-item {
      display: flex; align-items: center; gap: 14px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 16px; margin-bottom: 8px;
      transition: all 0.2s;
    }
    .tonight-item img { width: 38px; height: 54px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .tonight-item .info { flex: 1; min-width: 0; }
    .tonight-item h4 { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 700; margin-bottom: 2px; }
    .tonight-item .sub { font-size: 11px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tonight-item .remove-btn {
      background: none; border: 1px solid var(--border); color: var(--text3);
      padding: 5px 10px; border-radius: 6px; cursor: pointer;
      font-size: 11px; font-family: 'DM Sans', sans-serif; flex-shrink: 0;
    }
    .tonight-item .remove-btn:hover { border-color: rgba(255,255,255,0.12); color: var(--text2); }

    footer {
      padding: 40px 0 28px; text-align: center; color: #222;
      font-size: 10px; letter-spacing: 2px; text-transform: uppercase; font-weight: 300;
    }

    @keyframes fadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }

    .genre-empty { text-align: center; padding: 50px 20px; color: #444; }
    .genre-empty p { font-family: 'Playfair Display', serif; font-size: 16px; font-style: italic; }

    @media (max-width: 400px) {
      .movie-grid { grid-template-columns: 1fr; }
      .genre-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    }
  </style>
</head>
<body>
  <div id="ambient"></div>
  <div class="container" id="app"></div>

  <script>
    const state = {
      username: "kjig",
      movies: [],
      loading: false,
      progress: { stage: "", current: 0, total: 0 },
      error: null,
      loaded: false,
      view: "landing",
      selectedGenre: null,
      revealed: new Set(),
      tonightList: [],
      animKey: 0,
    };

    const GENRE_MAP = {
      "Action": { emoji: "💥", color: "#E63946" },
      "Comedy": { emoji: "😂", color: "#F4A261" },
      "Drama": { emoji: "🎭", color: "#457B9D" },
      "Horror": { emoji: "👻", color: "#6B0F1A" },
      "Science Fiction": { emoji: "🚀", color: "#7209B7" },
      "Romance": { emoji: "💕", color: "#E07A5F" },
      "Thriller": { emoji: "🔪", color: "#2B2D42" },
      "Animation": { emoji: "✨", color: "#06D6A0" },
      "Documentary": { emoji: "📽️", color: "#8D99AE" },
      "Fantasy": { emoji: "🐉", color: "#3A0CA3" },
      "Mystery": { emoji: "🔍", color: "#264653" },
      "Crime": { emoji: "🕵️", color: "#4A4E69" },
      "Adventure": { emoji: "🗺️", color: "#E9C46A" },
      "Family": { emoji: "👨‍👩‍👧‍👦", color: "#2A9D8F" },
      "War": { emoji: "⚔️", color: "#6C584C" },
      "Music": { emoji: "🎵", color: "#FF006E" },
      "History": { emoji: "📜", color: "#A68A64" },
      "Western": { emoji: "🤠", color: "#BC6C25" },
    };

    function gc(genre) { return GENRE_MAP[genre]?.color || "#666"; }
    function ge(genre) { return GENRE_MAP[genre]?.emoji || "🎬"; }

    function getGenres() {
      return [...new Set(state.movies.flatMap(m => m.genres))].sort();
    }

    function getFiltered() {
      return state.selectedGenre
        ? state.movies.filter(m => m.genres.includes(state.selectedGenre))
        : state.movies;
    }

    function shuffleArray(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    async function fetchWatchlist() {
      const user = state.username.trim();
      if (!user) return;

      state.loading = true;
      state.error = null;
      state.progress = { stage: "Fetching watchlist from Letterboxd...", current: 0, total: 0 };
      render();

      try {
        const res = await fetch(`/api/watchlist?username=${encodeURIComponent(user)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to fetch watchlist");

        state.movies = shuffleArray(data.movies.filter(m => m.synopsis));
        state.loaded = true;
        state.view = "genres";
      } catch (e) {
        state.error = e.message;
      } finally {
        state.loading = false;
        render();
      }
    }

    function selectGenre(genre) {
      state.selectedGenre = genre;
      state.revealed = new Set();
      state.animKey++;
      state.view = "browse";
      render();
      window.scrollTo(0, 0);
    }

    function showAll() {
      state.selectedGenre = null;
      state.revealed = new Set();
      state.animKey++;
      state.view = "browse";
      render();
      window.scrollTo(0, 0);
    }

    function toggleReveal(i) {
      state.revealed.has(i) ? state.revealed.delete(i) : state.revealed.add(i);
      render();
    }

    function addTonight(movie) {
      if (!state.tonightList.find(m => m.title === movie.title)) {
        state.tonightList.push(movie);
        render();
      }
    }

    function removeTonight(title) {
      state.tonightList = state.tonightList.filter(m => m.title !== title);
      render();
    }

    function inTonight(title) { return state.tonightList.some(m => m.title === title); }

    function doShuffle() {
      state.movies = shuffleArray(state.movies);
      state.revealed = new Set();
      state.animKey++;
      render();
    }

    function pickRandom() {
      const filtered = getFiltered();
      if (filtered.length === 0) return;
      const i = Math.floor(Math.random() * filtered.length);
      state.revealed = new Set([i]);
      render();
      setTimeout(() => {
        document.getElementById(`card-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }

    function goGenres() {
      state.view = "genres";
      state.selectedGenre = null;
      render();
    }

    function goLanding() {
      state.view = "landing";
      state.loaded = false;
      state.movies = [];
      state.selectedGenre = null;
      state.revealed = new Set();
      render();
    }

    function updateAmbient() {
      const el = document.getElementById("ambient");
      if (state.selectedGenre) {
        const c = gc(state.selectedGenre);
        el.style.background = `radial-gradient(ellipse at 20% 20%, ${c}12 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, ${c}08 0%, transparent 50%), var(--bg)`;
      } else {
        el.style.background = `radial-gradient(ellipse at 30% 0%, #14142a 0%, transparent 50%), radial-gradient(ellipse at 70% 100%, #1a0a1e 0%, transparent 50%), var(--bg)`;
      }
    }

    function render() {
      updateAmbient();
      const app = document.getElementById("app");

      let html = renderHeader();

      switch (state.view) {
        case "landing": html += renderLanding(); break;
        case "genres": html += renderGenres(); break;
        case "browse": html += renderBrowse(); break;
        case "tonight": html += renderTonight(); break;
      }

      html += `<footer>Read the plot. Skip the hype. Watch what speaks to you.</footer>`;
      app.innerHTML = html;
      bindEvents();
    }

    function renderHeader() {
      const navAction = state.loaded ? `onclick="goGenres()"` : "";
      let actions = "";

      if (state.loaded) {
        if (state.view === "browse") {
          actions += `<button class="pill" onclick="doShuffle()">↻ Shuffle</button>`;
          actions += `<button class="pill" onclick="pickRandom()">🎲 Random</button>`;
        }
        const tonightActive = state.view === "tonight" ? " active" : "";
        const tonightClick = state.view === "tonight"
          ? (state.selectedGenre ? `onclick="selectGenre('${state.selectedGenre.replace(/'/g, "\\'")}')"` : `onclick="goGenres()"`)
          : `onclick="state.view='tonight'; render();"`;
        actions += `<button class="pill${tonightActive}" ${tonightClick}>♡ Tonight's List${state.tonightList.length > 0 ? ` (${state.tonightList.length})` : ""}</button>`;
        actions += `<button class="pill" onclick="goLanding()" title="Change user">↺</button>`;
      }

      return `
        <header>
          <a class="logo" ${navAction}>
            <h1>BLIND PICK</h1>
            <span>cinema</span>
          </a>
          <div class="header-actions">${actions}</div>
        </header>
      `;
    }

    function renderLanding() {
      const loadingHtml = state.loading ? `
        <div class="progress">
          <div class="progress-bar"><div class="progress-fill" style="width:40%; animation: shimmer 2s linear infinite; background-size: 200% 100%;"></div></div>
          <p>${state.progress.stage || "Loading..."}</p>
        </div>
      ` : "";

      const errorHtml = state.error ? `<div class="error">${state.error}</div>` : "";

      return `
        <div class="landing">
          <div class="landing-icon">🎬</div>
          <h2>What should you watch tonight?</h2>
          <p class="sub">Pull your Letterboxd watchlist, filter by genre, and browse movies by synopsis alone — no titles, no bias. Just the story.</p>
          <div class="input-row">
            <div class="input-wrap">
              <label>letterboxd.com/</label>
              <input type="text" id="username-input" value="${state.username}" placeholder="username" />
            </div>
            <button class="fetch-btn" id="fetch-btn" ${state.loading ? "disabled" : ""}>
              ${state.loading ? "Loading..." : "Fetch Watchlist"}
            </button>
          </div>
          ${loadingHtml}
          ${errorHtml}
          <p style="color:#333; font-size:12px; margin-top:48px; font-weight:300;">
            Your watchlist must be public on Letterboxd for this to work.
          </p>
        </div>
      `;
    }

    function renderGenres() {
      const genres = getGenres();
      const genreCards = genres.map((g, i) => {
        const count = state.movies.filter(m => m.genres.includes(g)).length;
        const c = gc(g);
        return `
          <button class="genre-card" onclick="selectGenre('${g.replace(/'/g, "\\'")}')"
            style="background:linear-gradient(135deg,${c}12,${c}06); border-color:${c}20; animation: fadeUp 0.4s ease ${i * 0.04}s both;">
            <span class="emoji">${ge(g)}</span>
            <span class="name">${g}</span>
            <span class="count">${count} film${count !== 1 ? "s" : ""}</span>
          </button>
        `;
      }).join("");

      return `
        <div class="genres-view">
          <div class="genres-header">
            <p class="meta">${state.movies.length} films from <span style="color:#999">@${state.username}</span></p>
            <h2>What are you in the mood for?</h2>
          </div>
          <div style="text-align:center;">
            <button class="show-all-btn" onclick="showAll()">🎬 Show All (${state.movies.length})</button>
          </div>
          <div class="genre-grid">${genreCards}</div>
        </div>
      `;
    }

    function renderBrowse() {
      const filtered = getFiltered();
      const genreLabel = state.selectedGenre
        ? `<span class="current" style="color:${gc(state.selectedGenre)}">${ge(state.selectedGenre)} ${state.selectedGenre}</span>`
        : `<span class="current" style="color:#999">🎬 All Films</span>`;

      if (filtered.length === 0) {
        return `
          <div class="browse-view">
            <div class="breadcrumb">
              <button class="back" onclick="goGenres()">← Genres</button>
              <span class="sep">/</span>
              ${genreLabel}
            </div>
            <div class="genre-empty"><p>No films in this genre</p></div>
          </div>
        `;
      }

      const cards = filtered.map((movie, i) => {
        const isRevealed = state.revealed.has(i);
        const isInList = inTonight(movie.title);
        const cardColor = state.selectedGenre ? gc(state.selectedGenre) : (movie.genres[0] ? gc(movie.genres[0]) : "#666");

        const posterHtml = movie.poster ? `
          <div class="poster-area" style="height:${isRevealed ? 170 : 110}px; transition: height 0.4s;">
            <img src="${movie.poster}" alt="" style="filter:${isRevealed ? "none" : "blur(20px) brightness(0.3) grayscale(0.8)"};" loading="lazy" />
            <div class="gradient"></div>
            <div class="mystery-num">${String(i + 1).padStart(2, "0")}</div>
          </div>
        ` : `
          <div class="poster-area" style="height:50px; background:linear-gradient(135deg,${cardColor}10,transparent);">
            <div class="mystery-num">${String(i + 1).padStart(2, "0")}</div>
          </div>
        `;

        const titleArea = isRevealed ? `
          <h3>${movie.title}</h3>
          <p class="meta-line">${movie.director ? movie.director + " · " : ""}${movie.year || ""}${movie.rating ? " · ★ " + movie.rating : ""}${movie.runtime ? " · " + movie.runtime + "m" : ""}</p>
        ` : `
          <div class="mystery-title">Mystery Film #${i + 1}</div>
          <p class="mystery-meta">${movie.year || "?"}${movie.rating ? " · ★ " + movie.rating : ""}${movie.runtime ? " · " + movie.runtime + "m" : ""}</p>
        `;

        const genrePills = movie.genres.slice(0, 3).map(g =>
          `<span class="genre-pill" style="background:${gc(g)}15; color:${gc(g)}">${g}</span>`
        ).join("");

        const revealStyle = isRevealed
          ? `background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.06); color:#777;`
          : `background:${cardColor}18; border-color:${cardColor}35; color:${cardColor};`;

        const heartStyle = isInList
          ? `background:${cardColor}18; border-color:${cardColor}35; color:${cardColor};`
          : `background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.06); color:#555;`;

        const lbLinkHtml = isRevealed && movie.letterboxdUrl
          ? `<a class="lb-link" href="${movie.letterboxdUrl}" target="_blank" rel="noopener">LB</a>`
          : "";

        return `
          <div class="movie-card${isRevealed ? " revealed" : ""}" id="card-${i}"
            style="animation: fadeUp 0.4s ease ${i * 0.04}s both;${isRevealed ? ` background: linear-gradient(160deg,${cardColor}08,var(--surface)); border-color:${cardColor}25;` : ""}">
            ${posterHtml}
            <div class="body">
              <div class="title-area">${titleArea}</div>
              ${genrePills ? `<div class="genre-pills">${genrePills}</div>` : ""}
              <p class="synopsis">${movie.synopsis}</p>
              <div class="card-actions">
                <button class="reveal-btn" style="${revealStyle}" onclick="toggleReveal(${i})">
                  ${isRevealed ? "Hide Title" : "Reveal Title"}
                </button>
                <button class="heart-btn" style="${heartStyle}" onclick="${isInList ? `removeTonight('${movie.title.replace(/'/g, "\\'")}')` : `addTonight(state.movies[${state.movies.indexOf(movie)}])`}" title="${isInList ? "Remove" : "Add to tonight's list"}">
                  ${isInList ? "♥" : "♡"}
                </button>
                ${lbLinkHtml}
              </div>
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="browse-view">
          <div class="breadcrumb">
            <button class="back" onclick="goGenres()">← Genres</button>
            <span class="sep">/</span>
            ${genreLabel}
            <span class="num">(${filtered.length})</span>
          </div>
          <div class="movie-grid">${cards}</div>
        </div>
      `;
    }

    function renderTonight() {
      if (state.tonightList.length === 0) {
        return `
          <div class="tonight-view">
            <h2>Tonight's List</h2>
            <div class="tonight-empty">
              <div class="icon">🍿</div>
              <h3>Nothing here yet</h3>
              <p>Browse by genre and heart the movies that sound good</p>
            </div>
          </div>
        `;
      }

      const items = state.tonightList.map(movie => {
        const imgHtml = movie.poster
          ? `<img src="${movie.poster}" alt="" loading="lazy" />`
          : "";
        const genreStr = movie.genres.length > 0 ? ` · ${movie.genres.slice(0, 2).join(", ")}` : "";

        return `
          <div class="tonight-item">
            ${imgHtml}
            <div class="info">
              <h4>${movie.title}</h4>
              <p class="sub">${movie.year || ""}${movie.rating ? " · ★ " + movie.rating : ""}${genreStr}</p>
            </div>
            <button class="remove-btn" onclick="removeTonight('${movie.title.replace(/'/g, "\\'")}')">Remove</button>
          </div>
        `;
      }).join("");

      return `
        <div class="tonight-view">
          <h2>Tonight's List</h2>
          ${items}
        </div>
      `;
    }

    function bindEvents() {
      const input = document.getElementById("username-input");
      if (input) {
        input.addEventListener("input", (e) => { state.username = e.target.value; });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") fetchWatchlist(); });
      }
      const btn = document.getElementById("fetch-btn");
      if (btn) btn.addEventListener("click", fetchWatchlist);
    }

    render();
  </script>
</body>
</html>
```

---

## Customization

### Default username
In `public/index.html`, find `username: "kjig"` and change to your default.

### TMDB API key
The included key is a public demo key. For production, get a free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and update `TMDB_KEY` in `api/watchlist.js`.

### Cache duration
API responses are cached 5 minutes (`s-maxage=300`). Change in both `vercel.json` and `api/watchlist.js` to adjust.
