import { Config } from "@remotion/cli/config";

/**
 * Alpha-channel defaults. Overlays exist to be composited over CapCut footage, so a
 * transparent render is the norm here, not a special case.
 */
Config.setVideoImageFormat("png");
Config.setPixelFormat("yuva444p10le");
Config.setCodec("prores");
Config.setProResProfile("4444");
