// A YouTube video with none of YouTube's own controls, for the media viewer
// (media-viewer.js), which draws its own. Wraps the IFrame Player API, loaded
// once on first use.
//
//   createYouTubePlayer(host, videoId, { onState }) -> Promise<player>
//
// The player replaces `host` with YouTube's iframe. onState(playing, ended)
// reports play/pause, and the video reaching its end. The returned object:
// play(), pause(), toggle(), seek(seconds), skip(delta), time(), duration(),
// load(videoId), setVolume(0-100), volume(), mute(), unmute(), isMuted(),
// isPlaying(), destroy().
//
// youTubeStills(id): a video's largest still, then its standard one (not every
// video has the large one).

const API = "https://www.youtube.com/iframe_api";

let apiReady = null;
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API;
    script.async = true;
    script.onerror = () => {
      apiReady = null;
      reject(new Error("YouTube player failed to load"));
    };
    document.head.append(script);
  });
  return apiReady;
}

export const youTubeStills = (id) => [
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
];

export function youTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

export async function createYouTubePlayer(host, videoId, { onState } = {}) {
  const YT = await loadApi();
  let playing = false;
  let ready;
  const whenReady = new Promise((r) => (ready = r));
  // Phones only start a video by themselves when it is muted; the volume
  // button turns the sound on.
  const phone = window.matchMedia("(hover: none)").matches;

  const player = new YT.Player(host, {
    host: "https://www.youtube-nocookie.com",
    videoId,
    playerVars: {
      autoplay: 1,
      mute: phone ? 1 : 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      rel: 0,
      playsinline: 1,
      modestbranding: 1,
      origin: location.origin,
    },
    events: {
      onReady: () => ready(),
      onStateChange: (e) => {
        const now = e.data === YT.PlayerState.PLAYING;
        const ended = e.data === YT.PlayerState.ENDED;
        if (now !== playing || ended) {
          playing = now;
          onState?.(playing, ended);
        }
      },
    },
  });
  await whenReady;

  // Browsers may refuse to start a video with sound on their own (phones
  // especially); if it hasn't started shortly, it starts muted instead.
  player.playVideo();
  setTimeout(() => {
    let state = -1;
    try {
      state = player.getPlayerState();
    } catch {
      return;
    }
    if (
      state !== YT.PlayerState.PLAYING &&
      state !== YT.PlayerState.BUFFERING
    ) {
      player.mute();
      player.playVideo();
    }
  }, 1500);

  const safe = (fn, fallback = 0) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    toggle: () => (playing ? player.pauseVideo() : player.playVideo()),
    seek: (t) => player.seekTo(Math.max(0, t), true),
    skip(delta) {
      const end = safe(() => player.getDuration()) || Infinity;
      player.seekTo(
        Math.min(end, Math.max(0, safe(() => player.getCurrentTime()) + delta)),
        true,
      );
    },
    time: () => safe(() => player.getCurrentTime()),
    duration: () => safe(() => player.getDuration()),
    load: (id) => player.loadVideoById(id),
    setVolume(v) {
      player.setVolume(v);
      if (v > 0) player.unMute();
    },
    volume: () => safe(() => player.getVolume(), 100),
    mute: () => player.mute(),
    unmute: () => player.unMute(),
    isMuted: () => safe(() => player.isMuted(), false),
    isPlaying: () => playing,
    destroy: () => safe(() => player.destroy()),
  };
}
