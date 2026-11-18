import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, Modal, TextInput,
  Linking, StyleSheet, ActivityIndicator, Alert, Platform, StatusBar as RNStatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const STORE_KEY = 'mynewshub.channels.v1';
const REFRESH_MS = 30 * 60 * 1000;
const gnews = (domain) =>
  `https://news.google.com/rss/search?q=site:${domain}&hl=en&gl=US&ceid=US:en`;

const DEFAULT_CHANNELS = [
  { id: 'bbc', name: 'BBC News', category: 'news', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'sky', name: 'Sky News', category: 'news', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
  { id: 'reuters', name: 'Reuters', category: 'news', url: gnews('reuters.com') },
  { id: 'aj', name: 'Al Jazeera', category: 'news', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'lexpress', name: "L'Express (Mauritius)", category: 'news', url: gnews('lexpress.mu') },
  { id: 'defi', name: 'Defimedia', category: 'news', url: gnews('defimedia.info') },
  { id: 'bbcsport', name: 'BBC Sport', category: 'sports', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { id: 'skysports', name: 'Sky Sports', category: 'sports', url: 'https://www.skysports.com/rss/12040' },
  { id: 'soccernet', name: 'Soccernet (ESPN FC)', category: 'sports', url: 'https://www.espn.com/espn/rss/soccer/news' },
];

const BREAKING = /breaking|just in|urgent|developing|live:|live updates|news alert/i;

// ---------- RSS / Atom parsing (no dependencies) ----------
const decode = (s) =>
  (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
};

function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let link = decode(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const d = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = Date.parse(decode(d));
    return {
      title: decode(tag(b, 'title')),
      link,
      summary: decode(tag(b, 'description')).slice(0, 140),
      time: isNaN(t) ? 0 : t,
    };
  }).filter((i) => i.title && i.link);
}

async function fetchChannel(ch) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(ch.url, { signal: ctl.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = ch.url.includes('news.google.com');
    let items = parseFeed(await r.text()).map((i) => ({
      ...i,
      title: g ? i.title.replace(/\s+-\s+[^-]+$/, '') : i.title,
    }));
    items.sort((a, b) => b.time - a.time); // newest first
    return { items: items.slice(0, 20) };
  } catch (e) {
    return { items: [], error: e.name === 'AbortError' ? 'Timed out' : e.message };
  } finally {
    clearTimeout(to);
  }
}

const ago = (t) => {
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.round(h / 24) + ' d ago';
};

// ---------- App ----------
export default function App() {
  const [channels, setChannels] = useState(DEFAULT_CHANNELS);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('news');
  const [settings, setSettings] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [ready, setReady] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newCat, setNewCat] = useState('news');
  const chRef = useRef(channels);
  chRef.current = channels;

  const refresh = useCallback(async (list) => {
    const chs = list || chRef.current;
    setLoading(true);
    const results = await Promise.all(chs.map(fetchChannel));
    setData((prev) => {
      const next = { ...prev };
      chs.forEach((c, i) => { next[c.id] = results[i]; });
      return next;
    });
    setUpdated(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      let list = DEFAULT_CHANNELS;
      try {
        const s = await AsyncStorage.getItem(STORE_KEY);
        if (s) list = JSON.parse(s);
      } catch (e) {}
      setChannels(list);
      setReady(true);
      refresh(list);
    })();
    const id = setInterval(() => refresh(), REFRESH_MS); // auto refresh every 30 min
    return () => clearInterval(id);
  }, [refresh]);

  const save = (list) => {
    setChannels(list);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(list)).catch(() => {});
  };

  const removeChannel = (ch) =>
    Alert.alert('Delete channel', `Remove ${ch.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => save(channels.filter((c) => c.id !== ch.id)) },
    ]);

  const setCount = (id, delta) =>
    save(channels.map((c) => c.id === id
      ? { ...c, count: Math.min(20, Math.max(1, (c.count || 5) + delta)) } : c));

  const addChannel = () => {
    const name = newName.trim();
    let url = newUrl.trim();
    if (!name || !url) return Alert.alert('Missing info', 'Enter a name and a website or RSS URL.');
    try {
      const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
      if (u.pathname === '/' && !u.search) url = gnews(u.hostname.replace(/^www\./, ''));
      else url = u.toString();
    } catch (e) { return Alert.alert('Invalid URL', 'Please check the address.'); }
    const ch = { id: 'c' + Date.now(), name, url, category: newCat, count: 5 };
    save([...channels, ch]);
    setNewName(''); setNewUrl('');
    refresh([ch]);
  };

  const shown = channels.filter((c) => c.category === tab);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={s.header}>
        <View>
          <Text style={s.logo}>MyNewsHub</Text>
          <Text style={s.sub}>{updated ? 'Updated ' + ago(updated) : 'Loading…'}</Text>
        </View>
        <View style={s.row}>
          <TouchableOpacity style={s.iconBtn} onPress={() => refresh()}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.iconTxt}>↻</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => setSettings(true)}>
            <Text style={s.iconTxt}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.tabs}>
        {[['news', 'News'], ['sports', 'Sports']].map(([k, label]) => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)}>
            <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh()} colors={['#b3261e']} />}
      >
        {ready && shown.length === 0 && (
          <Text style={s.empty}>No channels here yet. Tap ⚙ to add one.</Text>
        )}
        {shown.map((ch) => {
          const d = data[ch.id];
          return (
            <View key={ch.id} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.chName}>{ch.name}</Text>
              </View>
              {!d && <ActivityIndicator style={{ margin: 16 }} color="#b3261e" />}
              {d && d.error && <Text style={s.err}>Couldn't load this channel ({d.error}).</Text>}
              {d && !d.error && d.items.length === 0 && <Text style={s.err}>No stories found.</Text>}
              {d && d.items.slice(0, ch.count || 5).map((it, i) => {
                const brk = BREAKING.test(it.title);
                return (
                  <TouchableOpacity key={i} style={[s.item, i > 0 && s.sep]} onPress={() => Linking.openURL(it.link)}>
                    <Text style={s.num}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      {brk && <Text style={s.badge}>BREAKING</Text>}
                      <Text style={[s.title, brk && s.breaking]}>{it.title}</Text>
                      {!!it.summary && !brk && <Text style={s.summary} numberOfLines={2}>{it.summary}</Text>}
                      <Text style={s.time}>{ago(it.time)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
        <Text style={s.foot}>Auto-refreshes every 30 minutes · pull down to refresh</Text>
      </ScrollView>

      <Modal visible={settings} animationType="slide" onRequestClose={() => setSettings(false)}>
        <View style={[s.root, { backgroundColor: '#f6f1e7' }]}>
          <View style={s.header}>
            <Text style={s.logo}>Channels</Text>
            <TouchableOpacity style={s.iconBtn} onPress={() => setSettings(false)}>
              <Text style={s.iconTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <Text style={s.hint}>Use − / + to choose how many stories each channel shows (1–20).</Text>
            {channels.map((c) => (
              <View key={c.id} style={s.chRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.chRowName}>{c.name}</Text>
                  <Text style={s.chRowCat}>{c.category === 'news' ? 'News' : 'Sports'}</Text>
                </View>
                <View style={s.stepper}>
                  <TouchableOpacity onPress={() => setCount(c.id, -1)}><Text style={s.stepBtn}>−</Text></TouchableOpacity>
                  <Text style={s.stepNum}>{c.count || 5}</Text>
                  <TouchableOpacity onPress={() => setCount(c.id, 1)}><Text style={s.stepBtn}>+</Text></TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => removeChannel(c)}>
                  <Text style={s.del}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}

            <Text style={s.formTitle}>Add a channel</Text>
            <TextInput style={s.input} placeholder="Name (e.g. CNN)" value={newName} onChangeText={setNewName} />
            <TextInput
              style={s.input} placeholder="Website (cnn.com) or RSS feed URL"
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              value={newUrl} onChangeText={setNewUrl}
            />
            <View style={s.row}>
              {[['news', 'News'], ['sports', 'Sports']].map(([k, label]) => (
                <TouchableOpacity key={k} style={[s.pill, newCat === k && s.pillOn]} onPress={() => setNewCat(k)}>
                  <Text style={[s.pillTxt, newCat === k && { color: '#fff' }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.addBtn} onPress={addChannel}>
              <Text style={s.addTxt}>Add channel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ marginTop: 22, alignSelf: 'center' }}
              onPress={() => Alert.alert('Reset', 'Restore the default channels?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Restore', onPress: () => { save(DEFAULT_CHANNELS); refresh(DEFAULT_CHANNELS); } },
              ])}
            >
              <Text style={s.del}>Restore default channels</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const serif = Platform.select({ ios: 'Georgia', default: 'serif' });
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f1e7' },
  header: {
    backgroundColor: '#1a2a44', paddingTop: (RNStatusBar.currentHeight || 40) + 8, paddingBottom: 12,
    paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  logo: { color: '#fff', fontSize: 26, fontWeight: '700', fontFamily: serif },
  sub: { color: '#c9a66b', fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  iconTxt: { color: '#fff', fontSize: 22 },
  tabs: { flexDirection: 'row', backgroundColor: '#1a2a44', paddingHorizontal: 12, paddingBottom: 10 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 18 },
  tabOn: { backgroundColor: '#c9a66b' },
  tabTxt: { color: '#c9d3e3', fontWeight: '600', fontSize: 15 },
  tabTxtOn: { color: '#1a2a44' },
  card: { backgroundColor: '#fffdf8', borderRadius: 12, marginBottom: 16, overflow: 'hidden', elevation: 2, borderWidth: 1, borderColor: '#e6dcc8' },
  cardHead: { backgroundColor: '#efe6d2', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: '#1a2a44' },
  chName: { fontSize: 18, fontWeight: '700', color: '#1a2a44', fontFamily: serif },
  item: { flexDirection: 'row', padding: 14 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d9cfb9' },
  num: { width: 24, fontSize: 18, fontWeight: '700', color: '#c9a66b', fontFamily: serif },
  title: { fontSize: 16, lineHeight: 22, color: '#1d1b18', fontFamily: serif },
  breaking: { color: '#d00000', fontWeight: '900' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#d00000', color: '#fff', fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, marginBottom: 4, overflow: 'hidden' },
  summary: { fontSize: 13, color: '#5a554b', marginTop: 4, lineHeight: 18 },
  time: { fontSize: 12, color: '#8a826f', marginTop: 5 },
  err: { padding: 14, color: '#8a826f' },
  empty: { textAlign: 'center', marginTop: 40, color: '#8a826f' },
  foot: { textAlign: 'center', color: '#8a826f', fontSize: 12, marginTop: 4 },
  chRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fffdf8', padding: 14, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e6dcc8' },
  chRowName: { fontSize: 16, fontWeight: '600', color: '#1d1b18' },
  chRowCat: { fontSize: 12, color: '#8a826f', marginTop: 2 },
  del: { color: '#d00000', fontWeight: '700' },
  hint: { color: '#8a826f', fontSize: 13, marginBottom: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#efe6d2', borderRadius: 18, marginRight: 14 },
  stepBtn: { fontSize: 22, color: '#1a2a44', paddingHorizontal: 12, paddingVertical: 2, fontWeight: '700' },
  stepNum: { minWidth: 22, textAlign: 'center', fontWeight: '700', color: '#1a2a44' },
  formTitle: { fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 10, color: '#1a2a44', fontFamily: serif },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d9cfb9', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 15 },
  pill: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 18, borderWidth: 1, borderColor: '#1a2a44', marginRight: 8 },
  pillOn: { backgroundColor: '#1a2a44' },
  pillTxt: { color: '#1a2a44', fontWeight: '600' },
  addBtn: { backgroundColor: '#b3261e', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  addTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
