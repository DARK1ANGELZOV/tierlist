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

const TIER_RANKS = [
  { key: 'Lt5', tier: 5, points: 1 },
  { key: 'Ht5', tier: 5, points: 5 },
  { key: 'Lt4', tier: 4, points: 10 },
  { key: 'Ht4', tier: 4, points: 15 },
  { key: 'Lt3', tier: 3, points: 20 },
  { key: 'Ht3', tier: 3, points: 25 },
  { key: 'Rlt2', tier: 2, points: 30 },
  { key: 'Lt2', tier: 2, points: 35 },
  { key: 'Rht2', tier: 2, points: 40 },
  { key: 'Ht2', tier: 2, points: 45 },
  { key: 'Rlt1', tier: 1, points: 50 },
  { key: 'Lt1', tier: 1, points: 55 },
  { key: 'Rht1', tier: 1, points: 60 },
  { key: 'Ht1', tier: 1, points: 80 },
] as const;

type CategorySlug = (typeof CATEGORY_CONFIG)[number]['slug'];
type TierLevel = 1 | 2 | 3 | 4 | 5;
type TierRankKey = (typeof TIER_RANKS)[number]['key'];

interface TierEntry {
  id: number;
  name: string;
  rank: TierRankKey;
  points: number;
  tier: TierLevel;
}

interface Player {
  id: number;
  name: string;
  score: number;
  rank: TierRankKey;
  tier: TierLevel;
}

interface CategoryState {
  tiers: Record<TierLevel, TierEntry[]>;
}

const rankMap = TIER_RANKS.reduce<Record<TierRankKey, { tier: TierLevel; points: number }>>(
  (accumulator, rank) => {
    accumulator[rank.key] = { tier: rank.tier, points: rank.points };
    return accumulator;
  },
  {} as Record<TierRankKey, { tier: TierLevel; points: number }>,
);

const rankSet = new Set<string>(TIER_RANKS.map((rank) => rank.key));
const categorySet = new Set<string>(CATEGORY_CONFIG.map((item) => item.slug));

const createEmptyTiers = (): Record<TierLevel, TierEntry[]> => ({
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
});

const categoriesState = CATEGORY_CONFIG.reduce<Record<CategorySlug, CategoryState>>(
  (accumulator, item) => {
    accumulator[item.slug] = {
      tiers: createEmptyTiers(),
    };
    return accumulator;
  },
  {} as Record<CategorySlug, CategoryState>,
);

const adminSessions = new Map<string, number>();
let nextTierEntryId = 1;

const normalizePlayerName = (value: string) =>
  value.trim().toLocaleLowerCase('ru');

const sortPlayers = (items: Player[]) =>
  [...items].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.name.localeCompare(right.name, 'ru');
  });

const getCategoryState = (slug: string): CategoryState | null => {
  if (!categorySet.has(slug)) {
    return null;
  }

  return categoriesState[slug as CategorySlug];
};

const allTierEntries = (category: CategoryState): TierEntry[] => [
  ...category.tiers[1],
  ...category.tiers[2],
  ...category.tiers[3],
  ...category.tiers[4],
  ...category.tiers[5],
];

const buildLeaderboard = (category: CategoryState): Player[] =>
  sortPlayers(
    allTierEntries(category).map((entry) => ({
      id: entry.id,
      name: entry.name,
      score: entry.points,
      rank: entry.rank,
      tier: entry.tier,
    })),
  );

const upsertTierEntry = (
  category: CategoryState,
  rawName: string,
  rankKey: TierRankKey,
) => {
  const rank = rankMap[rankKey];
  const normalizedTarget = normalizePlayerName(rawName);
  const displayName = rawName.trim();

  let existingEntryId: number | null = null;

  for (const tierLevel of [1, 2, 3, 4, 5] as const) {
    const existingIndex = category.tiers[tierLevel].findIndex(
      (entry) => normalizePlayerName(entry.name) === normalizedTarget,
    );

    if (existingIndex >= 0) {
      existingEntryId = category.tiers[tierLevel][existingIndex].id;
      category.tiers[tierLevel].splice(existingIndex, 1);
      break;
    }
  }

  const newEntry: TierEntry = {
    id: existingEntryId ?? nextTierEntryId++,
    name: displayName,
    rank: rankKey,
    points: rank.points,
    tier: rank.tier,
  };

  category.tiers[rank.tier].push(newEntry);
  return newEntry;
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

app.get('/tier-ranks', (_, res) => {
  res.json(TIER_RANKS);
});

app.get('/categories/:category/leaderboard', (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  res.json(buildLeaderboard(category));
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

  const slugsToReset: CategorySlug[] =
    requestedCategory && categorySet.has(requestedCategory)
      ? [requestedCategory as CategorySlug]
      : CATEGORY_CONFIG.map((item) => item.slug);

  for (const slug of slugsToReset) {
    categoriesState[slug].tiers = createEmptyTiers();
  }

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
  const rawRank = typeof req.body?.rank === 'string' ? req.body.rank.trim() : '';

  if (!rawName || !rankSet.has(rawRank)) {
    res.status(400).json({ error: 'Invalid leaderboard payload' });
    return;
  }

  const newEntry = upsertTierEntry(category, rawName, rawRank as TierRankKey);
  res.status(201).json(newEntry);
});

app.post('/categories/:category/tiers', requireAdmin, (req, res) => {
  const category = getCategoryState(req.params.category);
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawRank = typeof req.body?.rank === 'string' ? req.body.rank.trim() : '';

  if (!rawName || !rankSet.has(rawRank)) {
    res.status(400).json({ error: 'Invalid tier payload' });
    return;
  }

  const newEntry = upsertTierEntry(category, rawName, rawRank as TierRankKey);
  res.status(201).json(newEntry);
});

// Backward compatibility for existing `/players` consumers.
app.get('/players', (_, res) => {
  const defaultCategory = categoriesState['m1-novi'];
  res.json(buildLeaderboard(defaultCategory));
});

app.post('/players', requireAdmin, (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawRank = typeof req.body?.rank === 'string' ? req.body.rank.trim() : '';

  if (!rawName || !rankSet.has(rawRank)) {
    res.status(400).json({ error: 'Invalid player payload' });
    return;
  }

  const newEntry = upsertTierEntry(
    categoriesState['m1-novi'],
    rawName,
    rawRank as TierRankKey,
  );

  res.status(201).json(newEntry);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
