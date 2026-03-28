import crypto from 'crypto';
import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3005);
const DEFAULT_ADMIN_PASSWORD = '0zqCqlJuMmZW67OJ';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;

app.use(cors());
app.use(express.json());

const CATEGORY_CONFIG = [
  { slug: 'm1-novi', label: 'M1 Novi' },
  { slug: 'musketeer', label: 'Musketeer' },
  { slug: 'tournament', label: 'tournament' },
  { slug: 'vintovka', label: 'Vintovka' },
  { slug: 'kit-war', label: 'Kit War' },
] as const;

type CategorySlug = (typeof CATEGORY_CONFIG)[number]['slug'];
type TierLevel = 1 | 2 | 3 | 4 | 5;

interface Player {
  id: number;
  name: string;
  score: number;
}

interface TierEntry {
  id: number;
  name: string;
}

interface CategoryState {
  leaderboard: Player[];
  tiers: Record<TierLevel, TierEntry[]>;
}

const createEmptyTiers = (): Record<TierLevel, TierEntry[]> => ({
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
});

const categoriesState = CATEGORY_CONFIG.reduce<Record<CategorySlug, CategoryState>>((accumulator, item) => {
  accumulator[item.slug] = {
    leaderboard: [],
    tiers: createEmptyTiers(),
  };
  return accumulator;
}, {} as Record<CategorySlug, CategoryState>);

const adminSessions = new Map<string, number>();
let nextLeaderboardId = 1;
let nextTierEntryId = 1;

const sortPlayers = (items: Player[]) =>
  [...items].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.name.localeCompare(right.name, 'ru');
  });

const categorySet = new Set<string>(CATEGORY_CONFIG.map((item) => item.slug));

const getCategoryState = (slug: string): CategoryState | null => {
  if (!categorySet.has(slug)) {
    return null;
  }

  return categoriesState[slug as CategorySlug];
};

const authHeaderToToken = (authHeader: string | undefined) => {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
};

const requireAdmin: express.RequestHandler = (req, res, next) => {
  const token = authHeaderToToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: 'Admin token is required' });
    return;
  }

  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (expiresAt) {
      adminSessions.delete(token);
    }
    res.status(401).json({ error: 'Admin session is invalid or expired' });
    return;
  }

  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  next();
};

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/categories', (_, res) => {
  res.json(CATEGORY_CONFIG);
});

app.get('/categories/:category/leaderboard', (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  res.json(sortPlayers(category.leaderboard));
});

app.get('/categories/:category/tiers', (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  res.json({
    tier1: category.tiers[1],
    tier2: category.tiers[2],
    tier3: category.tiers[3],
    tier4: category.tiers[4],
    tier5: category.tiers[5],
  });
});

app.post('/admin/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  res.json({ token });
});

app.get('/admin/verify', requireAdmin, (_, res) => {
  res.json({ ok: true });
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  const token = authHeaderToToken(req.headers.authorization);
  if (token) {
    adminSessions.delete(token);
  }
  res.json({ ok: true });
});

app.post('/admin/reset', requireAdmin, (req, res) => {
  const requestedCategory =
    typeof req.body?.category === 'string' ? req.body.category : null;

  const slugsToReset: CategorySlug[] = requestedCategory && categorySet.has(requestedCategory)
    ? [requestedCategory as CategorySlug]
    : CATEGORY_CONFIG.map((item) => item.slug);

  for (const slug of slugsToReset) {
    categoriesState[slug].leaderboard = [];
    categoriesState[slug].tiers = createEmptyTiers();
  }

  nextLeaderboardId = 1;
  nextTierEntryId = 1;

  res.json({ ok: true, reset: slugsToReset });
});

app.post('/categories/:category/leaderboard', requireAdmin, (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawScore = req.body?.score;

  if (!rawName || typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0) {
    res.status(400).json({ error: 'Invalid leaderboard payload' });
    return;
  }

  const newPlayer: Player = {
    id: nextLeaderboardId++,
    name: rawName,
    score: rawScore,
  };

  category.leaderboard.push(newPlayer);
  res.status(201).json(newPlayer);
});

app.post('/categories/:category/tiers', requireAdmin, (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawTier = req.body?.tier;

  if (!rawName || ![1, 2, 3, 4, 5].includes(rawTier)) {
    res.status(400).json({ error: 'Invalid tier payload' });
    return;
  }

  const tier = rawTier as TierLevel;
  const newEntry: TierEntry = {
    id: nextTierEntryId++,
    name: rawName,
  };

  category.tiers[tier].push(newEntry);
  res.status(201).json(newEntry);
});

// Backward compatibility for existing `/players` consumers.
app.get('/players', (_, res) => {
  const defaultCategory = categoriesState['m1-novi'];
  res.json(sortPlayers(defaultCategory.leaderboard));
});

app.post('/players', requireAdmin, (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawScore = req.body?.score;

  if (!rawName || typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0) {
    res.status(400).json({ error: 'Invalid player payload' });
    return;
  }

  const newPlayer: Player = {
    id: nextLeaderboardId++,
    name: rawName,
    score: rawScore,
  };

  categoriesState['m1-novi'].leaderboard.push(newPlayer);
  res.status(201).json(newPlayer);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
