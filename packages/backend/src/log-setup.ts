/**
 * אתחול לוגים של השרת — חייב להיות מיובא ראשון ב-server.ts (לפני כל שאר היבואים).
 *
 * קורא LOG_LEVEL, LOG_NS, LOG_FORMAT, LOG_WIRE מ-process.env.
 * קיצור דרך LOG_WIRE: "acp" | "ws" | "1" — מגדיר level=trace + את namespace ה-wire הרלוונטי.
 */
import { initLogger, parseEnvConfig } from "@drive-coding/core/log"

const config = parseEnvConfig()
initLogger(config)
