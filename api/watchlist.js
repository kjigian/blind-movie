// /api/watchlist.js — Vercel Serverless Function
// Fetches a Letterboxd watchlist via RSS and enriches with TMDB data

const TMDB_KEY = process.env.TMDB_API_KEY || "2dca580c2a14b55200e784d157207b4d";

export default async function handler(req, res) {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Missing username parameter" });
  }

  try {
    // 1. Fetch the RSS feed (server-side = no CORS issues)
    const rssUrl = `https://letterboxd.com/${encodeURIComponent(username)}/watchlist/rss/`;
    const rssRes = await fetch(rssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BlindPick/1.0; +https://blind-pick.vercel.app)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!rssRes.ok) {
      console.error(`Letterboxd RSS returned HTTP ${rssRes.status} for "${username}"`);
      return res.status(404).json({
        error: `Could not fetch watchlist for "${username}" (HTTP ${rssRes.status}). Make sure the username is correct and the watchlist is public.`,
      });
    }

    const xml = await rssRes.text();

    // 2. Parse RSS items
    const movies = parseRSS(xml);

    if (movies.length === 0) {
      return res.status(404).json({
        error: `No movies found in ${username}'s watchlist. It may be empty or private.`,
      });
    }

    // 3. Enrich with TMDB (parallel batches of 5, capped at 200 movies)
    const MAX_MOVIES = 200;
    const capped = movies.slice(0, MAX_MOVIES);
    const enriched = [];
    const batchSize = 5;

    for (let i = 0; i < capped.length; i += batchSize) {
      const batch = capped.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(enrichWithTMDB));
      enriched.push(...results);
    }

    // 4. Return
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
    const guid = extractTag(itemXml, "letterboxd:filmId") || "";

    // Title format: "Movie Name (2024)"
    const yearMatch = title.match(/\((\d{4})\)\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const cleanTitle = yearMatch ? title.replace(/\s*\(\d{4}\)\s*$/, "").trim() : title.trim();

    // Extract poster image from description HTML
    const imgMatch = description.match(/src=["']([^"']+)["']/);
    const lbPoster = imgMatch ? imgMatch[1] : null;

    // Extract text from description (strip HTML)
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
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular tags
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(regex);
  return m ? m[1].trim() : null;
}

async function enrichWithTMDB(movie) {
  try {
    const query = encodeURIComponent(movie.title);
    const yearParam = movie.year ? `&year=${movie.year}` : "";
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearParam}`;
    const fetchOpts = { signal: AbortSignal.timeout(8000) };

    const searchRes = await fetch(searchUrl, fetchOpts);
    if (!searchRes.ok) {
      console.error(`TMDB search failed for "${movie.title}": HTTP ${searchRes.status}`);
      throw new Error(`TMDB search HTTP ${searchRes.status}`);
    }
    const searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      const r = searchData.results[0];

      // Get full details for genres + runtime
      const detailRes = await fetch(
        `https://api.themoviedb.org/3/movie/${r.id}?api_key=${TMDB_KEY}&append_to_response=credits`,
        fetchOpts
      );
      if (!detailRes.ok) {
        console.error(`TMDB detail fetch failed for "${movie.title}" (id=${r.id}): HTTP ${detailRes.status}`);
        throw new Error(`TMDB detail HTTP ${detailRes.status}`);
      }
      const detail = await detailRes.json();

      // Get director from credits
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

  // Fallback
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
