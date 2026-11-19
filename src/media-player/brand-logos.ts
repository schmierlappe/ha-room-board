/**
 * The apps' logos, carried in the card.
 *
 * GlassHome served icon sets of brand logos (cbi:, simple-icons:); Home
 * Assistant has only the ones installed in it. So the few logos the media
 * cards draw for an app with no artwork of its own come with the card, from
 * Simple Icons (CC0). Prime Video and Disney+ are not in Simple Icons any more:
 * they are drawn as their name (see brand.ts).
 */
import {
  siAppletv,
  siCrunchyroll,
  siDazn,
  siDeutschetelekom,
  siHbo,
  siMax,
  siNetflix,
  siParamountplus,
  siPlex,
  siRtl,
  siSky,
  siSpotify,
  siTwitch,
  siYoutube,
  siZdf,
} from "simple-icons";

export const BRAND_PATHS: Record<string, string> = {
  appletv: siAppletv.path,
  crunchyroll: siCrunchyroll.path,
  dazn: siDazn.path,
  telekom: siDeutschetelekom.path,
  hbo: siHbo.path,
  max: siMax.path,
  netflix: siNetflix.path,
  paramountplus: siParamountplus.path,
  plex: siPlex.path,
  rtl: siRtl.path,
  sky: siSky.path,
  spotify: siSpotify.path,
  twitch: siTwitch.path,
  youtube: siYoutube.path,
  zdf: siZdf.path,
};
