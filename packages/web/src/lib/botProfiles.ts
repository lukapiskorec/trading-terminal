/** Bot profile pictures and default names/subtitles. */

export const BOT_PROFILES = [
  { name: "Gekko-01", subtitle: "THE BULL" },
  { name: "Zaku-G", subtitle: "WALL ST. ZAKU" },
  { name: "Wing-Zero-Gekko", subtitle: "ZERO PROFIT" },
  { name: "Dom-G", subtitle: "BLUE CHIP DOM" },
  { name: "Strike-Gekko", subtitle: "STRIKE PRICE" },
  { name: "Gouf-G", subtitle: "THE BEAR TRAP" },
  { name: "Qubeley-G", subtitle: "OPTION QUEEN" },
  { name: "Nu-Gekko", subtitle: "MARGIN CALL" },
  { name: "Sazabi-G", subtitle: "THE RAID" },
  { name: "Gundam-7S", subtitle: "THE VETERAN" },
  { name: "Rick Dias", subtitle: "BEAR RAID" },
  { name: "Gundam Mk-II", subtitle: "THE ARBITRAGER" },
  { name: "Zeta-G", subtitle: "THE FUTURES" },
  { name: "Rick Dom", subtitle: "BIG SHORT" },
  { name: "Gundam Alex", subtitle: "INSIDER" },
  { name: "Gelgoog", subtitle: "THE HEDGE" },
  { name: "GM", subtitle: "THE ASSOCIATE" },
  { name: "Hyaku Shiki", subtitle: "GOLDEN PARACHUTE" },
  { name: "Eva-01", subtitle: "THE THIRD IMPACT" },
  { name: "Eva-02", subtitle: "ASUKA'S ASSETS" },
  { name: "Eva-00", subtitle: "REI'S RETURNS" },
  { name: "Gurren Lagann", subtitle: "DRILL TO THE TOP" },
  { name: "King Kittan", subtitle: "KITTAN CAPITAL" },
  { name: "Yoko's Mech", subtitle: "SNIPER STOCK" },
  { name: "Lancelot", subtitle: "ZERO'S ZERO-SUM" },
  { name: "Guren", subtitle: "KALLEN'S CRASH" },
  { name: "Shinkiro", subtitle: "LELOUCH'S LEVERAGE" },
  { name: "Optimus Prime", subtitle: "THE BULL" },
  { name: "Megatron", subtitle: "WALL ST. ZAKU" },
  { name: "Bumblebee-Gekko", subtitle: "ZERO PROFIT" },
  { name: "Starscream", subtitle: "FLASH0RENT" },
  { name: "Soundwave", subtitle: "STOCK AXE" },
  { name: "Grimlock", subtitle: "THE BEAR TRAP" },
  { name: "Shockwave", subtitle: "OPTION QUEEN" },
  { name: "Jazz", subtitle: "MARGIN CALL" },
  { name: "Devastator", subtitle: "WRECKING BALL" },
] as const;

export const BOT_PIC_COUNT = 36;

export function botPicUrl(index: number): string {
  return `/bot_pics/bot_pic_${String(index).padStart(2, "0")}.png`;
}

/** Pick a random profile that isn't already used by existing bots. */
export function randomBotProfile(usedIndices: number[]): {
  picIndex: number;
  name: string;
  subtitle: string;
} {
  const available = Array.from({ length: BOT_PIC_COUNT }, (_, i) => i).filter(
    (i) => !usedIndices.includes(i),
  );
  const pool = available.length > 0 ? available : Array.from({ length: BOT_PIC_COUNT }, (_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return { picIndex: idx, name: BOT_PROFILES[idx].name, subtitle: BOT_PROFILES[idx].subtitle };
}
