// Transcripts of YouTube videos, for overviews of lectures. No API key: the
// caption tracks listed on the video page are fetched directly. Works when the
// video has subtitles (made by the author or generated automatically).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function youtubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[2] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** What to do when YouTube will not give the subtitles to the app. */
export const BLOCKED =
  "YouTube не отдаёт субтитры приложению: просит подтвердить, что запрос не от бота. Обойти это нельзя, но можно принести текст самому: под видео «…» → «Показать текст видео», скопируй текст в файл .txt, или скачай субтитры .srt/.vtt. Затем приложи файл в «Тема» или «Файлы».";

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

/** The JSON object assigned to `name` in a page's inline script. */
function inlineJson(html: string, name: string): unknown {
  const at = html.indexOf(name);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Author subtitles before automatic ones; Russian, then English, then whatever there is. */
function pickTrack(tracks: Track[]): Track | null {
  const rank = (t: Track) => (t.languageCode.startsWith("ru") ? 0 : t.languageCode.startsWith("en") ? 2 : 4) + (t.kind === "asr" ? 1 : 0);
  return [...tracks].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const clock = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

/** Lines of about half a minute, each starting with its time, so the overview can link to moments. */
function toLines(data: Json3): string {
  const out: string[] = [];
  let buf = "";
  let at = -1;
  for (const e of data.events ?? []) {
    const text = (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const t = (e.tStartMs ?? 0) / 1000;
    if (at < 0) at = t;
    buf += (buf ? " " : "") + text;
    if (t - at >= 30 || buf.length > 600) {
      out.push(`[${clock(at)}|${Math.floor(at)}] ${buf}`);
      buf = "";
      at = -1;
    }
  }
  if (buf) out.push(`[${clock(Math.max(0, at))}|${Math.floor(Math.max(0, at))}] ${buf}`);
  return out.join("\n");
}

export async function youtubeTranscript(input: string): Promise<{ id: string; title: string; text: string; language: string; auto: boolean; duration: number }> {
  const id = youtubeId(input);
  if (!id) throw new Error("Не похоже на ссылку на видео YouTube");
  const page = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ru`, {
    headers: { "user-agent": UA, "accept-language": "ru,en;q=0.8", cookie: "CONSENT=YES+cb; SOCS=CAI" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!page.ok) throw new Error(`YouTube не открылся: ${page.status}`);
  const html = await page.text();
  const player = inlineJson(html, "ytInitialPlayerResponse") as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string; lengthSeconds?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
  } | null;
  if (!player) throw new Error("Не удалось прочитать страницу видео. Возможно, YouTube попросил подтверждение; попробуй позже.");
  const status = player.playabilityStatus?.status;
  if (status && status !== "OK") {
    const reason = player.playabilityStatus?.reason ?? status;
    // YouTube sometimes asks apps to prove they are not a bot. That check is not
    // for us to get around: the learner can bring the subtitles as a file.
    if (status === "LOGIN_REQUIRED" || /бот|bot|sign in|войдите/i.test(reason)) throw new Error(BLOCKED);
    throw new Error(`Видео недоступно: ${reason}`);
  }
  const track = pickTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
  if (!track) throw new Error("У этого видео нет субтитров, ни авторских, ни автоматических: текст взять неоткуда.");
  const res = await fetch(`${track.baseUrl}&fmt=json3`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  const raw = res.ok ? await res.text() : "";
  let data: Json3 = {};
  try {
    data = raw ? (JSON.parse(raw) as Json3) : {};
  } catch {}
  const text = toLines(data);
  if (!text) throw new Error(BLOCKED);
  return {
    id,
    title: player.videoDetails?.title ?? `Видео ${id}`,
    text,
    language: track.languageCode,
    auto: track.kind === "asr",
    duration: Number(player.videoDetails?.lengthSeconds ?? 0),
  };
}

export const isSubtitleFile = (name: string) => /\.(srt|vtt)$/i.test(name);

/**
 * Subtitle files (.srt, .vtt) as timed lines like a fetched transcript:
 * "[м:сс|секунды] текст", grouped by about half a minute.
 */
export function subtitlesToText(raw: string): string {
  const cues: { t: number; text: string }[] = [];
  const time = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->/;
  for (const block of raw.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => time.test(l));
    if (i < 0) continue;
    const m = time.exec(lines[i])!;
    const t = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const text = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Auto-generated captions repeat the previous line; keep each phrase once.
    if (text && text !== cues.at(-1)?.text) cues.push({ t, text });
  }
  return toLines({ events: cues.map((c) => ({ tStartMs: c.t * 1000, segs: [{ utf8: c.text }] })) });
}

