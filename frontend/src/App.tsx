import { useEffect, useRef, useState, type ReactNode } from 'react';
import axios, { AxiosError } from 'axios';

type TierLevel = 1 | 2 | 3 | 4 | 5;
type ApiCategory = { slug: string; label: string };
type Category = ApiCategory & { icon: string };
type TierRank = { key: TierRankKey; tier: TierLevel; points: number };
type Player = { id: number; name: string; score: number; rank: TierRankKey; tier: TierLevel };
type TierEntry = { id: number; name: string; rank: TierRankKey; points: number; tier: TierLevel };
type TierResponse = {
  tier1: TierEntry[];
  tier2: TierEntry[];
  tier3: TierEntry[];
  tier4: TierEntry[];
  tier5: TierEntry[];
};
type TierBoard = Record<TierLevel, TierEntry[]>;
type RuntimeMode = 'api' | 'shared';
type SharedState = {
  version: number;
  nextId: number;
  categories: Record<string, TierBoard>;
};

const RAW_API_URL = import.meta.env.VITE_API_URL;
const API_URL =
  typeof RAW_API_URL === 'string' && RAW_API_URL.trim()
    ? RAW_API_URL.trim()
    : 'http://localhost:3005';
const IS_GITHUB_PAGES =
  typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
const FORCE_SHARED_MODE = IS_GITHUB_PAGES;
const SHARED_STORE_URL =
  'https://jsonblob.com/api/jsonBlob/019d34b1-b8b1-7a66-8372-be3865afd0aa';
const SHARED_CACHE_KEY = 'elarium_shared_state_cache_v1';
const TOKEN_KEY = 'elarium_admin_token';
const SHARED_ADMIN_TOKEN = 'elarium_shared_admin_token';
const ADMIN_PASSWORD = '0zqCqlJuMmZW67OJ';
const CUP_ICON = 'https://cistiers.com/assets/cup512-r1aH9J6f.png';
const AVATAR = 'https://storage.cistiers.com/fallback/bust.webp';
const ICONS: Record<string, string> = {
  'm1-novi': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2694.svg',
  musketeer: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3af.svg',
  tournament: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3c6.svg',
  vintovka: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f52b.svg',
  'kit-war': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f6e1.svg',
  add: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2795.svg',
  lock: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f512.svg',
  unlock: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f513.svg',
};
const FALLBACK: ApiCategory[] = [
  { slug: 'm1-novi', label: 'M1 Novi' },
  { slug: 'musketeer', label: 'Musketeer' },
  { slug: 'tournament', label: 'tournament' },
  { slug: 'vintovka', label: 'Vintovka' },
  { slug: 'kit-war', label: 'Kit War' },
];
const TIERS: TierLevel[] = [1, 2, 3, 4, 5];
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
type TierRankKey = (typeof TIER_RANKS)[number]['key'];

const emptyBoard = (): TierBoard => ({ 1: [], 2: [], 3: [], 4: [], 5: [] });
const normalizeApiBoard = (data?: Partial<TierResponse>): TierBoard => ({
  1: Array.isArray(data?.tier1) ? data.tier1 : [],
  2: Array.isArray(data?.tier2) ? data.tier2 : [],
  3: Array.isArray(data?.tier3) ? data.tier3 : [],
  4: Array.isArray(data?.tier4) ? data.tier4 : [],
  5: Array.isArray(data?.tier5) ? data.tier5 : [],
});
const normalizeStoredBoard = (value: unknown): TierBoard => {
  if (!value || typeof value !== 'object') return emptyBoard();
  const input = value as Record<string, unknown>;
  const toEntries = (key: string) => (Array.isArray(input[key]) ? (input[key] as TierEntry[]) : []);
  return {
    1: toEntries('1'),
    2: toEntries('2'),
    3: toEntries('3'),
    4: toEntries('4'),
    5: toEntries('5'),
  };
};
const rankMeta = (rank: TierRankKey) => TIER_RANKS.find((item) => item.key === rank) ?? TIER_RANKS[0];
const sortPlayers = (items: Player[]) =>
  [...items].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'ru'));
const buildPlayersFromBoard = (board: TierBoard): Player[] =>
  sortPlayers([...board[1], ...board[2], ...board[3], ...board[4], ...board[5]].map((entry) => ({
    id: entry.id,
    name: entry.name,
    score: entry.points,
    rank: entry.rank,
    tier: entry.tier,
  })));
const createDefaultSharedState = (): SharedState => ({
  version: 1,
  nextId: 1,
  categories: Object.fromEntries(FALLBACK.map((item) => [item.slug, emptyBoard()])),
});
const normalizeSharedState = (value: unknown): SharedState => {
  const defaults = createDefaultSharedState();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const input = value as Partial<SharedState>;
  if (typeof input.nextId === 'number' && Number.isFinite(input.nextId) && input.nextId > 0) {
    defaults.nextId = Math.floor(input.nextId);
  }

  if (input.categories && typeof input.categories === 'object') {
    for (const item of FALLBACK) {
      defaults.categories[item.slug] = normalizeStoredBoard(
        (input.categories as Record<string, unknown>)[item.slug],
      );
    }
  }

  return defaults;
};
const readCachedSharedState = (): SharedState | null => {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SHARED_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeSharedState(JSON.parse(raw));
  } catch {
    return null;
  }
};
const persistSharedState = (state: SharedState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHARED_CACHE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota/storage exceptions
  }
};
const readSharedState = async (): Promise<SharedState> => {
  try {
    const response = await axios.get<unknown>(SHARED_STORE_URL, { timeout: 6000 });
    const normalized = normalizeSharedState(response.data);
    persistSharedState(normalized);
    return normalized;
  } catch {
    const initial = createDefaultSharedState();
    try {
      await axios.put(SHARED_STORE_URL, initial, { timeout: 6000 });
      persistSharedState(initial);
    } catch {
      // no-op, client will still work with in-memory fallback state
    }
    return initial;
  }
};
const writeSharedState = async (state: SharedState) => {
  await axios.put(SHARED_STORE_URL, state, { timeout: 6000 });
  persistSharedState(state);
};
const cloneSharedState = (state: SharedState): SharedState =>
  JSON.parse(JSON.stringify(state)) as SharedState;
const buildSharedCollections = (state: SharedState, categories: Category[]) => {
  const nextBoards: Record<string, TierBoard> = {};
  const nextPlayers: Record<string, Player[]> = {};

  for (const item of categories) {
    const board = state.categories[item.slug] ?? emptyBoard();
    nextBoards[item.slug] = board;
    nextPlayers[item.slug] = buildPlayersFromBoard(board);
  }

  return { nextBoards, nextPlayers };
};
const upsertSharedEntry = (state: SharedState, slug: string, rawName: string, rank: TierRankKey) => {
  if (!state.categories[slug]) {
    state.categories[slug] = emptyBoard();
  }
  const board = state.categories[slug];
  const normalizedName = rawName.trim().toLocaleLowerCase('ru');
  let existingId: number | null = null;

  for (const tier of TIERS) {
    const idx = board[tier].findIndex(
      (entry) => entry.name.trim().toLocaleLowerCase('ru') === normalizedName,
    );
    if (idx >= 0) {
      existingId = board[tier][idx].id;
      board[tier].splice(idx, 1);
      break;
    }
  }

  const meta = rankMeta(rank);
  board[meta.tier].push({
    id: existingId ?? state.nextId++,
    name: rawName.trim(),
    rank: meta.key,
    points: meta.points,
    tier: meta.tier,
  });
};
const placeClass = (index: number) => {
  if (index === 0) return 'leaderboard-row-gold';
  if (index === 1) return 'leaderboard-row-silver';
  if (index === 2) return 'leaderboard-row-bronze';
  return '';
};
const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'очко'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
      ? 'очка'
      : 'очков';

function App() {
  const [cats, setCats] = useState<Category[]>([]);
  const [active, setActive] = useState('m1-novi');
  const [view, setView] = useState<'leaderboard' | 'tiers'>('leaderboard');
  const [players, setPlayers] = useState<Record<string, Player[]>>({});
  const [boards, setBoards] = useState<Record<string, TierBoard>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RuntimeMode>(FORCE_SHARED_MODE ? 'shared' : 'api');

  const [token, setToken] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rank, setRank] = useState<TierRankKey>('Lt5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rankOptions, setRankOptions] = useState<TierRank[]>([...TIER_RANKS]);
  const sharedStateRef = useRef<SharedState | null>(null);
  const sharedWriteQueueRef = useRef(Promise.resolve());
  const pendingSharedWritesRef = useRef(0);

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const activeCat = cats.find((item) => item.slug === active) ?? {
    slug: 'm1-novi',
    label: 'M1 Novi',
    icon: ICONS['m1-novi'],
  };
  const activePlayers = players[active] ?? [];
  const activeBoard = boards[active] ?? emptyBoard();

  const activateSharedMode = async () => {
    setMode('shared');
    const resolvedCategories = FALLBACK.map((item) => ({
      ...item,
      icon: ICONS[item.slug] ?? ICONS['m1-novi'],
    }));
    setRankOptions([...TIER_RANKS].sort((left, right) => left.points - right.points));
    setCats(resolvedCategories);
    setActive(resolvedCategories[0]?.slug ?? 'm1-novi');

    const cached = readCachedSharedState() ?? createDefaultSharedState();
    sharedStateRef.current = cached;
    const cachedCollections = buildSharedCollections(cached, resolvedCategories);
    setBoards(cachedCollections.nextBoards);
    setPlayers(cachedCollections.nextPlayers);

    void readSharedState()
      .then((shared) => {
        sharedStateRef.current = shared;
        const remoteCollections = buildSharedCollections(shared, resolvedCategories);
        setBoards(remoteCollections.nextBoards);
        setPlayers(remoteCollections.nextPlayers);
      })
      .catch(() => null);
  };

  const fetchCategory = async (
    slug: string,
    targetMode: RuntimeMode = mode,
    forceRemote = false,
  ) => {
    if (targetMode === 'shared') {
      if (!forceRemote && sharedStateRef.current) {
        const board = sharedStateRef.current.categories[slug] ?? emptyBoard();
        setBoards((prev) => ({ ...prev, [slug]: board }));
        setPlayers((prev) => ({ ...prev, [slug]: buildPlayersFromBoard(board) }));
        return;
      }

      const shared = await readSharedState();
      sharedStateRef.current = shared;
      const board = shared.categories[slug] ?? emptyBoard();
      setBoards((prev) => ({ ...prev, [slug]: board }));
      setPlayers((prev) => ({ ...prev, [slug]: buildPlayersFromBoard(board) }));
      return;
    }

    const [playersResponse, tiersResponse] = await Promise.all([
      axios.get<Player[]>(`${API_URL}/categories/${slug}/leaderboard`),
      axios.get<TierResponse>(`${API_URL}/categories/${slug}/tiers`),
    ]);
    setPlayers((prev) => ({ ...prev, [slug]: sortPlayers(playersResponse.data) }));
    setBoards((prev) => ({ ...prev, [slug]: normalizeApiBoard(tiersResponse.data) }));
  };

  useEffect(() => {
    const init = async () => {
      if (FORCE_SHARED_MODE) {
        await activateSharedMode();
        setLoading(false);
        return;
      }

      try {
        await axios.get(`${API_URL}/health`, { timeout: 2500 });
        setMode('api');
        const [categoriesResponse, rankResponse] = await Promise.all([
          axios.get<ApiCategory[]>(`${API_URL}/categories`),
          axios.get<TierRank[]>(`${API_URL}/tier-ranks`).catch(() => ({ data: [...TIER_RANKS] })),
        ]);
        const resolvedCategories = (categoriesResponse.data.length
          ? categoriesResponse.data
          : FALLBACK
        ).map((item) => ({ ...item, icon: ICONS[item.slug] ?? ICONS['m1-novi'] }));

        setRankOptions([...rankResponse.data].sort((left, right) => left.points - right.points));
        setCats(resolvedCategories);
        setActive(resolvedCategories[0]?.slug ?? 'm1-novi');
        await Promise.all(resolvedCategories.map((item) => fetchCategory(item.slug, 'api').catch(() => null)));
      } catch {
        await activateSharedMode();
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return;

    if (mode === 'shared') {
      if (saved === SHARED_ADMIN_TOKEN) {
        setToken(saved);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
      return;
    }

    axios
      .get(`${API_URL}/admin/verify`, { headers: { Authorization: `Bearer ${saved}` } })
      .then(() => setToken(saved))
      .catch(() => localStorage.removeItem(TOKEN_KEY));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'shared') return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (pendingSharedWritesRef.current > 0) return;
      void fetchCategory(active, 'shared', true).catch(() => null);
    }, 2500);
    return () => clearInterval(interval);
  }, [mode, active]);

  const openAdminModal = (nextError = '') => {
    setPassword('');
    setError(nextError);
    setAdminOpen(true);
  };

  const onAuthError = (err: unknown) => {
    if (mode !== 'api') return;
    if (err instanceof AxiosError && err.response?.status === 401) {
      setToken('');
      localStorage.removeItem(TOKEN_KEY);
      setEntryOpen(false);
      openAdminModal('Сессия администратора истекла.');
    }
  };

  const doLogin = async () => {
    if (!password.trim()) return;

    if (mode === 'shared') {
      setBusy(true);
      setError('');
      if (password.trim() === ADMIN_PASSWORD) {
        setToken(SHARED_ADMIN_TOKEN);
        localStorage.setItem(TOKEN_KEY, SHARED_ADMIN_TOKEN);
        setAdminOpen(false);
        setPassword('');
      } else {
        setError('Неверный пароль.');
      }
      setBusy(false);
      return;
    }

    try {
      setBusy(true);
      setError('');
      const response = await axios.post<{ token: string }>(`${API_URL}/admin/login`, {
        password: password.trim(),
      });
      setToken(response.data.token);
      localStorage.setItem(TOKEN_KEY, response.data.token);
      setAdminOpen(false);
      setPassword('');
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 401) {
          setError('Неверный пароль.');
        } else {
          await activateSharedMode();
          if (password.trim() === ADMIN_PASSWORD) {
            setToken(SHARED_ADMIN_TOKEN);
            localStorage.setItem(TOKEN_KEY, SHARED_ADMIN_TOKEN);
            setAdminOpen(false);
            setPassword('');
          } else {
            setError('Неверный пароль.');
          }
        }
      } else {
        setError('Ошибка входа. Попробуй еще раз.');
      }
    } finally {
      setBusy(false);
    }
  };

  const openEntry = () => {
    setName('');
    setRank('Lt5');
    if (!token) {
      openAdminModal('Нужен вход администратора.');
      return;
    }
    setEntryOpen(true);
  };

  const submit = async () => {
    if (!name.trim() || !token) return;

    if (mode === 'shared') {
      const cleanName = name.trim();
      setBusy(true);
      setError('');

      let shared = sharedStateRef.current;
      if (!shared) {
        shared = await readSharedState();
      }

      upsertSharedEntry(shared, active, cleanName, rank);
      sharedStateRef.current = shared;

      const board = shared.categories[active] ?? emptyBoard();
      setBoards((prev) => ({ ...prev, [active]: board }));
      setPlayers((prev) => ({ ...prev, [active]: buildPlayersFromBoard(board) }));
      setEntryOpen(false);
      setName('');
      setRank('Lt5');
      setBusy(false);

      const snapshot = cloneSharedState(shared);
      sharedWriteQueueRef.current = sharedWriteQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          pendingSharedWritesRef.current += 1;
          try {
            await writeSharedState(snapshot);
          } finally {
            pendingSharedWritesRef.current = Math.max(0, pendingSharedWritesRef.current - 1);
          }
        })
        .catch(async () => {
          await fetchCategory(active, 'shared');
        });
      return;
    }

    try {
      setBusy(true);
      await axios.post(
        `${API_URL}/categories/${active}/tiers`,
        { name: name.trim(), rank },
        { headers },
      );
      await fetchCategory(active, 'api');
      setEntryOpen(false);
    } catch (err) {
      onAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background text-text">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="sticky top-2 z-50 mb-4 h-[72px]">
            <nav className="backdrop-blur-sm rounded-xl navbar-container flex items-center justify-between px-4 h-18">
              <h1 className="text-2xl font-bold text-white">Elarium</h1>
              <div className="hidden md:flex items-center space-x-3">
                <button
                  type="button"
                  className="icon-wrapper w-12 h-12 flex items-center justify-center rounded-lg hover:bg-white/5"
                  onClick={() => setView('leaderboard')}
                >
                  <img
                    src={CUP_ICON}
                    alt="Таблица лидеров"
                    className={`w-10 h-10 object-contain ${view === 'leaderboard' ? 'active-icon' : 'inactive-icon'}`}
                  />
                </button>
                <div className="divider" />
                {cats.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    className="icon-wrapper w-12 h-12 flex items-center justify-center rounded-lg hover:bg-white/5"
                    onClick={() => {
                      setActive(item.slug);
                      setView('tiers');
                      if (mode === 'api') {
                        void fetchCategory(item.slug, 'api').catch(() => null);
                      }
                    }}
                  >
                    <img
                      src={item.icon}
                      alt={item.label}
                      className={`w-10 h-10 object-contain ${view === 'tiers' && active === item.slug ? 'active-icon' : 'inactive-icon'}`}
                    />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="icon-wrapper w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5"
                  onClick={openEntry}
                >
                  <img src={ICONS.add} alt="Добавить" className="w-5 h-5 opacity-80" />
                </button>
                <button
                  type="button"
                  className="icon-wrapper w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5"
                  onClick={() => {
                    if (token) {
                      setToken('');
                      localStorage.removeItem(TOKEN_KEY);
                      return;
                    }
                    openAdminModal();
                  }}
                >
                  <img src={token ? ICONS.unlock : ICONS.lock} alt="Админ" className="w-5 h-5 opacity-80" />
                </button>
              </div>
            </nav>
          </div>

          <div className="pb-8 mt-6">
            {view === 'leaderboard' ? (
              <div className="space-y-2">
                <div className="table-navbar">
                  <div className="navbar-content">
                    <div className="tierlist-info">
                      <img src={CUP_ICON} alt={activeCat.label} className="tierlist-icon" />
                      <h2 className="tierlist-title">Leaderboard: {activeCat.label}</h2>
                    </div>
                  </div>
                </div>
                {loading ? (
                  <div className="loading-container">
                    <p>Загрузка...</p>
                  </div>
                ) : activePlayers.length === 0 ? (
                  <div className="bg-[#1a1a1a] rounded-2xl p-6">
                    <h3 className="font-bold text-xl mb-1">Список пока пуст</h3>
                    <p className="text-[#e0e0e0]">Назначьте первый ранк тира через админку.</p>
                  </div>
                ) : (
                  activePlayers.map((player, index) => (
                    <div
                      key={player.id}
                      className={`bg-[#1a1a1a] rounded-2xl p-4 flex items-center leaderboard-row ${placeClass(index)}`}
                    >
                      <img src={AVATAR} alt={player.name} className="w-12 h-12 object-contain mr-3" />
                      <div className="flex-1">
                        <p className="font-bold">
                          {index + 1}. {player.name}
                        </p>
                        <p className="text-[#e0e0e0]">
                          {player.rank} • {player.score} {plural(player.score)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="table-view">
                <div className="table-navbar">
                  <div className="navbar-content">
                    <div className="tierlist-info">
                      <img src={activeCat.icon} alt={activeCat.label} className="tierlist-icon" />
                      <h2 className="tierlist-title">{activeCat.label}</h2>
                    </div>
                  </div>
                </div>
                <div className="table-container">
                  <div className="table-wrapper">
                    <div className="table-scroll-container">
                      <div className="table-grid">
                        {TIERS.map((tierValue) => (
                          <div key={tierValue} className="tier-column">
                            <div className="tier-title">TIER {tierValue}</div>
                            <div className="tier-content">
                              <div className="players-list scrollable-content">
                                {activeBoard[tierValue].length ? (
                                  activeBoard[tierValue].map((entry) => (
                                    <div key={entry.id} className="player-item high-tier">
                                      <div className="tier-badge" data-tier={`T${tierValue}`} />
                                      <div className="player-info">
                                        <img src={AVATAR} alt={entry.name} className="player-avatar" />
                                        <span className="player-name">
                                          {entry.name} · {entry.rank}
                                        </span>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="player-item low-tier">
                                    <div className="player-info">
                                      <span className="player-name text-[#808080]">Пусто</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {adminOpen ? (
        <Modal title="Вход администратора" onClose={() => setAdminOpen(false)}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Введите пароль"
            className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3"
          />
          {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}
          <button
            type="button"
            className="rounded-xl bg-white text-background font-bold py-3 px-4 w-full"
            disabled={busy}
            onClick={doLogin}
          >
            {busy ? 'Проверяем...' : 'Войти'}
          </button>
        </Modal>
      ) : null}

      {entryOpen ? (
        <Modal title="Назначить ранк тира" onClose={() => setEntryOpen(false)}>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Имя"
            className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3"
          />
          <select
            value={rank}
            onChange={(event) => setRank(event.target.value as TierRankKey)}
            className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3"
          >
            {rankOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.key} — {item.points} очков (TIER {item.tier})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-xl bg-white text-background font-bold py-3 px-4 w-full"
            disabled={busy}
            onClick={submit}
          >
            {busy ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </Modal>
      ) : null}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="modal-content w-full max-w-md rounded-2xl bg-[#1a1a1a] shadow-2xl border border-primary/15 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-white mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default App;
