import { useEffect, useState, type ReactNode } from 'react';
import axios, { AxiosError } from 'axios';

type TierLevel = 1 | 2 | 3 | 4 | 5;
type ApiCategory = { slug: string; label: string };
type Category = ApiCategory & { icon: string };
type Player = { id: number; name: string; score: number };
type TierEntry = { id: number; name: string };
type TierResponse = { tier1: TierEntry[]; tier2: TierEntry[]; tier3: TierEntry[]; tier4: TierEntry[]; tier5: TierEntry[] };
type TierBoard = Record<TierLevel, TierEntry[]>;

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3005';
const TOKEN_KEY = 'elarium_admin_token';
const DEFAULT_ADMIN_PASSWORD = '0zqCqlJuMmZW67OJ';
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

const emptyBoard = (): TierBoard => ({ 1: [], 2: [], 3: [], 4: [], 5: [] });
const normalize = (data?: Partial<TierResponse>): TierBoard => ({
  1: Array.isArray(data?.tier1) ? data.tier1 : [],
  2: Array.isArray(data?.tier2) ? data.tier2 : [],
  3: Array.isArray(data?.tier3) ? data.tier3 : [],
  4: Array.isArray(data?.tier4) ? data.tier4 : [],
  5: Array.isArray(data?.tier5) ? data.tier5 : [],
});
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'очко' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'очка' : 'очков');

function App() {
  const [cats, setCats] = useState<Category[]>([]);
  const [active, setActive] = useState('m1-novi');
  const [view, setView] = useState<'leaderboard' | 'tiers'>('leaderboard');
  const [players, setPlayers] = useState<Record<string, Player[]>>({});
  const [boards, setBoards] = useState<Record<string, TierBoard>>({});
  const [loading, setLoading] = useState(true);

  const [token, setToken] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<'leaderboard' | 'tiers'>('leaderboard');
  const [password, setPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [name, setName] = useState('');
  const [score, setScore] = useState('');
  const [tier, setTier] = useState<TierLevel>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const activeCat = cats.find((x) => x.slug === active) ?? { slug: 'm1-novi', label: 'M1 Novi', icon: ICONS['m1-novi'] };
  const activePlayers = players[active] ?? [];
  const activeBoard = boards[active] ?? emptyBoard();

  const fetchCategory = async (slug: string) => {
    const [p, t] = await Promise.all([axios.get<Player[]>(`${API_URL}/categories/${slug}/leaderboard`), axios.get<TierResponse>(`${API_URL}/categories/${slug}/tiers`)]);
    setPlayers((prev) => ({ ...prev, [slug]: [...p.data].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru')) }));
    setBoards((prev) => ({ ...prev, [slug]: normalize(t.data) }));
  };

  useEffect(() => {
    const init = async () => {
      try {
        const c = await axios.get<ApiCategory[]>(`${API_URL}/categories`);
        const resolved = (c.data.length ? c.data : FALLBACK).map((item) => ({ ...item, icon: ICONS[item.slug] ?? ICONS['m1-novi'] }));
        setCats(resolved);
        setActive(resolved[0]?.slug ?? 'm1-novi');
        await Promise.all(resolved.map((item) => fetchCategory(item.slug).catch(() => null)));
      } catch {
        setCats(FALLBACK.map((item) => ({ ...item, icon: ICONS[item.slug] })));
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    axios.get(`${API_URL}/admin/verify`, { headers: { Authorization: `Bearer ${saved}` } }).then(() => setToken(saved)).catch(() => localStorage.removeItem(TOKEN_KEY));
  }, []);

  const onAuthError = (e: unknown) => {
    if (e instanceof AxiosError && e.response?.status === 401) {
      setToken('');
      localStorage.removeItem(TOKEN_KEY);
      setEntryOpen(false);
      setError('Сессия администратора истекла.');
      setAdminOpen(true);
    }
  };

  const doLogin = async () => {
    if (!password.trim()) return;
    try {
      setBusy(true);
      setError('');
      const r = await axios.post<{ token: string }>(`${API_URL}/admin/login`, { password: password.trim() });
      setToken(r.data.token);
      localStorage.setItem(TOKEN_KEY, r.data.token);
      setAdminOpen(false);
      setPassword('');
    } catch {
      setError('Неверный пароль.');
    } finally {
      setBusy(false);
    }
  };

  const openEntry = (mode: 'leaderboard' | 'tiers') => {
    setEntryMode(mode);
    setName('');
    setScore('');
    setTier(1);
    if (!token) {
      setError('Нужен вход администратора.');
      setAdminOpen(true);
      return;
    }
    setEntryOpen(true);
  };

  const submit = async () => {
    if (!name.trim() || !token) return;
    try {
      setBusy(true);
      if (entryMode === 'leaderboard') {
        const n = Number(score);
        if (!Number.isFinite(n) || score.trim() === '') return;
        await axios.post(`${API_URL}/categories/${active}/leaderboard`, { name: name.trim(), score: n }, { headers });
      } else {
        await axios.post(`${API_URL}/categories/${active}/tiers`, { name: name.trim(), tier }, { headers });
      }
      await fetchCategory(active);
      setEntryOpen(false);
    } catch (e) {
      onAuthError(e);
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
                <button type="button" className="icon-wrapper w-12 h-12 flex items-center justify-center rounded-lg hover:bg-white/5" onClick={() => setView('leaderboard')}>
                  <img src={CUP_ICON} alt="Таблица лидеров" className={`w-10 h-10 object-contain ${view === 'leaderboard' ? 'active-icon' : 'inactive-icon'}`} />
                </button>
                <div className="divider" />
                {cats.map((c) => (
                  <button key={c.slug} type="button" className="icon-wrapper w-12 h-12 flex items-center justify-center rounded-lg hover:bg-white/5" onClick={() => { setActive(c.slug); setView('tiers'); }}>
                    <img src={c.icon} alt={c.label} className={`w-10 h-10 object-contain ${view === 'tiers' && active === c.slug ? 'active-icon' : 'inactive-icon'}`} />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="icon-wrapper w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5" onClick={() => openEntry(view === 'leaderboard' ? 'leaderboard' : 'tiers')}><img src={ICONS.add} alt="Добавить" className="w-5 h-5 opacity-80" /></button>
                <button
                  type="button"
                  className="icon-wrapper w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5"
                  onClick={() => {
                    if (token) {
                      setToken('');
                      localStorage.removeItem(TOKEN_KEY);
                      return;
                    }
                    setAdminOpen(true);
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
                    <div className="tierlist-info"><img src={CUP_ICON} alt={activeCat.label} className="tierlist-icon" /><h2 className="tierlist-title">Leaderboard: {activeCat.label}</h2></div>
                  </div>
                </div>
                {loading ? <div className="loading-container"><p>Загрузка...</p></div> : activePlayers.length === 0 ? <div className="bg-[#1a1a1a] rounded-2xl p-6"><h3 className="font-bold text-xl mb-1">Список пока пуст</h3><p className="text-[#e0e0e0]">Добавьте первого игрока через админ-пароль.</p></div> : activePlayers.map((p, i) => <div key={p.id} className="bg-[#1a1a1a] rounded-2xl p-4 flex items-center"><img src={AVATAR} alt={p.name} className="w-12 h-12 object-contain mr-3" /><div className="flex-1"><p className="font-bold">{i + 1}. {p.name}</p><p className="text-[#e0e0e0]">{p.score} {plural(p.score)}</p></div></div>)}
              </div>
            ) : (
              <div className="table-view">
                <div className="table-navbar">
                  <div className="navbar-content">
                    <div className="tierlist-info"><img src={activeCat.icon} alt={activeCat.label} className="tierlist-icon" /><h2 className="tierlist-title">{activeCat.label}</h2></div>
                  </div>
                </div>
                <div className="table-container"><div className="table-wrapper"><div className="table-scroll-container"><div className="table-grid">
                  {TIERS.map((t) => (
                    <div key={t} className="tier-column">
                      <div className="tier-title">TIER {t}</div>
                      <div className="tier-content"><div className="players-list scrollable-content">
                        {activeBoard[t].length ? activeBoard[t].map((entry) => <div key={entry.id} className="player-item high-tier"><div className="tier-badge" data-tier={`T${t}`} /><div className="player-info"><img src={AVATAR} alt={entry.name} className="player-avatar" /><span className="player-name">{entry.name}</span></div></div>) : <div className="player-item low-tier"><div className="player-info"><span className="player-name text-[#808080]">Пусто</span></div></div>}
                      </div></div>
                    </div>
                  ))}
                </div></div></div></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {adminOpen ? <Modal title="Вход администратора" onClose={() => setAdminOpen(false)}>
        <p className="text-text/70 mb-3">Пароль: {DEFAULT_ADMIN_PASSWORD}</p>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите пароль" className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3" />
        {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}
        <button type="button" className="rounded-xl bg-white text-background font-bold py-3 px-4 w-full" disabled={busy} onClick={doLogin}>{busy ? 'Проверяем...' : 'Войти'}</button>
      </Modal> : null}

      {entryOpen ? <Modal title={entryMode === 'leaderboard' ? 'Добавить игрока' : 'Добавить в тир'} onClose={() => setEntryOpen(false)}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3" />
        {entryMode === 'leaderboard' ? <input type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder="Очки" className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3" /> : <select value={tier} onChange={(e) => setTier(Number(e.target.value) as TierLevel)} className="w-full px-4 py-3 rounded-xl bg-[#121212] border border-primary/15 mb-3">{TIERS.map((t) => <option key={t} value={t}>Tier {t}</option>)}</select>}
        <button type="button" className="rounded-xl bg-white text-background font-bold py-3 px-4 w-full" disabled={busy} onClick={submit}>{busy ? 'Сохраняем...' : 'Сохранить'}</button>
      </Modal> : null}
    </>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center px-4" onClick={onClose}>
      <div className="modal-content w-full max-w-md rounded-2xl bg-[#1a1a1a] shadow-2xl border border-primary/15 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default App;
