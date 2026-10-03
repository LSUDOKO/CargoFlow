// Major container ports, bundled so port search works offline and without an API key. Coordinates are the
// container terminals (degrees, WGS84), checked against the UN/LOCODE code list (most within 25 km of the
// listed locality; terminals that sit outside their city, like Yangshan or Maasvlakte, use the terminal).
// The six ports of the original wizard presets keep the exact coordinates those presets committed on chain, so
// older shipments still get their port names on the map.

export type Port = {
  /** UN/LOCODE, e.g. SGSIN */
  code: string;
  name: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  lat: number;
  lon: number;
  /** other names people search for */
  aka?: string;
};

type Row = [code: string, name: string, lat: number, lon: number, aka?: string];

// prettier-ignore
const ROWS: Row[] = [
  // East Asia
  ["CNSHA", "Shanghai", 31.23, 121.49, "Yangshan Waigaoqiao"],
  ["CNNGB", "Ningbo-Zhoushan", 29.93, 121.85, "Beilun"],
  ["CNSZX", "Shenzhen", 22.57, 114.27, "Yantian Shekou"],
  ["CNCAN", "Guangzhou", 22.75, 113.63, "Nansha Canton"],
  ["CNTAO", "Qingdao", 36.0, 120.25, "Qianwan"],
  ["CNTSN", "Tianjin", 38.98, 117.78, "Xingang"],
  ["CNXMN", "Xiamen", 24.45, 118.07, "Haicang Amoy"],
  ["CNDLC", "Dalian", 38.93, 121.65],
  ["CNLYG", "Lianyungang", 34.75, 119.45],
  ["CNFOC", "Fuzhou", 26.0, 119.45, "Mawei"],
  ["HKHKG", "Hong Kong", 22.34, 114.12, "Kwai Tsing"],
  ["TWKHH", "Kaohsiung", 22.6, 120.28],
  ["TWKEL", "Keelung", 25.14, 121.74],
  ["TWTPE", "Taipei Port", 25.16, 121.39],
  ["KRPUS", "Busan", 35.08, 128.82, "Pusan"],
  ["KRINC", "Incheon", 37.45, 126.6],
  ["KRKAN", "Gwangyang", 34.9, 127.7],
  ["JPTYO", "Tokyo", 35.62, 139.79],
  ["JPYOK", "Yokohama", 35.45, 139.66],
  ["JPNGO", "Nagoya", 35.05, 136.88],
  ["JPUKB", "Kobe", 34.67, 135.21],
  ["JPOSA", "Osaka", 34.64, 135.42],
  ["JPHKT", "Hakata", 33.62, 130.4, "Fukuoka"],
  // Southeast Asia
  ["VNSGN", "Ho Chi Minh City", 10.76, 106.79, "Saigon Cat Lai"],
  ["VNCMT", "Cai Mep", 10.53, 107.03, "Vung Tau"],
  ["VNHPH", "Haiphong", 20.85, 106.75],
  ["VNDAD", "Da Nang", 16.13, 108.22],
  ["THLCH", "Laem Chabang", 13.08, 100.88],
  ["THBKK", "Bangkok", 13.7, 100.58, "Khlong Toei"],
  ["MYPKG", "Port Klang", 3.0, 101.39, "Westports Northport"],
  ["MYTPP", "Tanjung Pelepas", 1.36, 103.55],
  ["MYPEN", "Penang", 5.41, 100.35],
  ["SGSIN", "Singapore", 1.264, 103.82, "Pasir Panjang Tuas"],
  ["IDTPP", "Tanjung Priok", -6.1, 106.88, "Jakarta"],
  ["IDSUB", "Surabaya", -7.2, 112.73, "Tanjung Perak"],
  ["IDBLW", "Belawan", 3.79, 98.69, "Medan"],
  ["PHMNL", "Manila", 14.6, 120.96],
  ["PHBTG", "Batangas", 13.75, 121.04],
  ["KHKOS", "Sihanoukville", 10.64, 103.5],
  ["MMRGN", "Yangon", 16.77, 96.17, "Rangoon"],
  // South Asia
  ["LKCMB", "Colombo", 6.95, 79.84],
  ["INNSA", "Nhava Sheva", 18.95, 72.95, "JNPT Jawaharlal Nehru Mumbai"],
  ["INBOM", "Mumbai", 18.94, 72.84, "Bombay"],
  ["INMUN", "Mundra", 22.74, 69.7],
  ["INPAV", "Pipavav", 20.9, 71.51],
  ["INHZA", "Hazira", 21.1, 72.65, "Surat"],
  ["INMAA", "Chennai", 13.1, 80.3, "Madras"],
  ["INKAT", "Kattupalli", 13.3, 80.35],
  ["INCOK", "Kochi", 9.97, 76.26, "Cochin Vallarpadam"],
  ["INVTZ", "Visakhapatnam", 17.69, 83.29, "Vizag"],
  ["INCCU", "Kolkata", 22.55, 88.31, "Calcutta"],
  ["BDCGP", "Chittagong", 22.3, 91.8, "Chattogram"],
  ["PKKHI", "Karachi", 24.84, 66.98],
  ["PKBQM", "Port Qasim", 24.77, 67.33],
  // Middle East and Red Sea
  ["AEJEA", "Jebel Ali", 25.011, 55.061, "Dubai"],
  ["AEKHL", "Khalifa Port", 24.81, 54.65, "Abu Dhabi"],
  ["AEKLF", "Khor Fakkan", 25.35, 56.36, "Sharjah"],
  ["OMSLL", "Salalah", 16.94, 54.0],
  ["OMSOH", "Sohar", 24.5, 56.63],
  ["SAJED", "Jeddah", 21.47, 39.17],
  ["SAKAC", "King Abdullah Port", 22.52, 39.09, "Rabigh"],
  ["SADMM", "Dammam", 26.5, 50.2, "King Abdulaziz"],
  ["QAHMD", "Hamad Port", 25.01, 51.62, "Doha"],
  ["BHKBS", "Khalifa Bin Salman", 26.2, 50.72, "Bahrain"],
  ["KWSWK", "Shuwaikh", 29.35, 47.93, "Kuwait"],
  ["IQUQR", "Umm Qasr", 30.03, 47.95],
  ["JOAQJ", "Aqaba", 29.43, 34.98],
  ["DJJIB", "Djibouti", 11.6, 43.13, "Doraleh"],
  ["SDPZU", "Port Sudan", 19.6, 37.22],
  ["EGSOK", "Sokhna", 29.65, 32.35, "Ain Sukhna"],
  ["EGPSD", "Port Said", 31.22, 32.36, "Suez Canal"],
  ["EGALY", "Alexandria", 31.18, 29.87, "El Dekheila"],
  ["ILHFA", "Haifa", 32.82, 35.0],
  ["ILASH", "Ashdod", 31.83, 34.64],
  ["TRMER", "Mersin", 36.79, 34.65],
  ["TRAMR", "Ambarli", 40.97, 28.69, "Istanbul"],
  ["TRIZM", "Izmir", 38.44, 27.15],
  ["TRGEM", "Gemlik", 40.43, 29.1, "Bursa"],
  // Europe
  ["NLRTM", "Rotterdam", 51.95, 4.14, "Maasvlakte"],
  ["NLAMS", "Amsterdam", 52.41, 4.82],
  ["BEANR", "Antwerp", 51.28, 4.3, "Antwerpen Bruges"],
  ["BEZEE", "Zeebrugge", 51.33, 3.2],
  ["DEHAM", "Hamburg", 53.54, 9.93],
  ["DEBRV", "Bremerhaven", 53.58, 8.53],
  ["DEWVN", "Wilhelmshaven", 53.59, 8.15, "JadeWeserPort"],
  ["FRLEH", "Le Havre", 49.47, 0.15],
  ["FRDKK", "Dunkirk", 51.04, 2.17, "Dunkerque"],
  ["FRMRS", "Marseille-Fos", 43.42, 4.86, "Fos-sur-Mer"],
  ["GBFXT", "Felixstowe", 51.95, 1.31],
  ["GBLGP", "London Gateway", 51.5, 0.47, "Thames"],
  ["GBSOU", "Southampton", 50.9, -1.43],
  ["GBLIV", "Liverpool", 53.46, -3.02],
  ["IEDUB", "Dublin", 53.35, -6.2],
  ["ESALG", "Algeciras", 36.13, -5.43, "Gibraltar"],
  ["ESVLC", "Valencia", 39.44, -0.32],
  ["ESBCN", "Barcelona", 41.34, 2.16],
  ["ESBIO", "Bilbao", 43.35, -3.05],
  ["ESLPA", "Las Palmas", 28.14, -15.41, "Canary Islands"],
  ["PTSIE", "Sines", 37.95, -8.87],
  ["PTLIS", "Lisbon", 38.7, -9.17, "Lisboa"],
  ["PTLEI", "Leixões", 41.18, -8.7, "Porto Leixoes"],
  ["ITGOA", "Genoa", 44.41, 8.9, "Genova"],
  ["ITSPE", "La Spezia", 44.1, 9.83],
  ["ITLIV", "Livorno", 43.56, 10.3, "Leghorn"],
  ["ITNAP", "Naples", 40.84, 14.27, "Napoli"],
  ["ITGIT", "Gioia Tauro", 38.45, 15.9],
  ["ITVCE", "Venice", 45.45, 12.26, "Venezia Marghera"],
  ["ITTRS", "Trieste", 45.62, 13.76],
  ["MTMAR", "Marsaxlokk", 35.82, 14.54, "Malta Freeport"],
  ["GRPIR", "Piraeus", 37.95, 23.57, "Athens"],
  ["GRSKG", "Thessaloniki", 40.63, 22.92],
  ["SIKOP", "Koper", 45.56, 13.74],
  ["HRRJK", "Rijeka", 45.33, 14.43],
  ["ROCND", "Constanta", 44.15, 28.65, "Constanța"],
  ["BGVAR", "Varna", 43.19, 27.92],
  ["UAODS", "Odesa", 46.5, 30.75, "Odessa"],
  ["GEPTI", "Poti", 42.15, 41.66],
  ["PLGDN", "Gdansk", 54.4, 18.71, "Gdańsk DCT"],
  ["PLGDY", "Gdynia", 54.53, 18.55],
  ["LTKLJ", "Klaipeda", 55.7, 21.13, "Klaipėda"],
  ["LVRIX", "Riga", 57.02, 24.06],
  ["EETLL", "Tallinn", 59.45, 24.77, "Muuga"],
  ["FIHEL", "Helsinki", 60.21, 25.19, "Vuosaari"],
  ["SEGOT", "Gothenburg", 57.69, 11.86, "Göteborg"],
  ["SEMMA", "Malmö", 55.62, 12.99, "Malmo"],
  ["DKAAR", "Aarhus", 56.15, 10.23],
  ["DKCPH", "Copenhagen", 55.7, 12.61, "København"],
  ["NOOSL", "Oslo", 59.89, 10.74],
  // Africa
  ["MAPTM", "Tanger Med", 35.89, -5.5, "Tangier"],
  ["MACAS", "Casablanca", 33.61, -7.6],
  ["DZALG", "Algiers", 36.77, 3.07, "Alger"],
  ["TNRDS", "Radès", 36.8, 10.28, "Rades Tunis"],
  ["SNDKR", "Dakar", 14.68, -17.42],
  ["CIABJ", "Abidjan", 5.27, -4.01],
  ["GHTEM", "Tema", 5.63, 0.01, "Accra"],
  ["TGLFW", "Lomé", 6.13, 1.28, "Lome"],
  ["BJCOO", "Cotonou", 6.35, 2.43],
  ["NGAPP", "Apapa", 6.44, 3.37, "Lagos Tin Can"],
  ["CMDLA", "Douala", 4.03, 9.69],
  ["AOLAD", "Luanda", -8.8, 13.25],
  ["NAWVB", "Walvis Bay", -22.95, 14.5],
  ["ZACPT", "Cape Town", -33.91, 18.43],
  ["ZAPLZ", "Gqeberha", -33.96, 25.63, "Port Elizabeth"],
  ["ZAZBA", "Ngqura", -33.8, 25.68, "Coega"],
  ["ZADUR", "Durban", -29.87, 31.03],
  ["MZMPM", "Maputo", -25.97, 32.57],
  ["TZDAR", "Dar es Salaam", -6.83, 39.29],
  ["KEMBA", "Mombasa", -4.05, 39.64, "Kilindini"],
  ["MGTMM", "Toamasina", -18.15, 49.42, "Tamatave"],
  ["MUPLU", "Port Louis", -20.15, 57.49, "Mauritius"],
  // North America
  ["USLAX", "Los Angeles", 33.74, -118.26, "San Pedro"],
  ["USLGB", "Long Beach", 33.75, -118.21],
  ["USOAK", "Oakland", 37.8, -122.32, "San Francisco Bay"],
  ["USSEA", "Seattle", 47.58, -122.35],
  ["USTIW", "Tacoma", 47.27, -122.41],
  ["USHNL", "Honolulu", 21.31, -157.87, "Hawaii"],
  ["USANC", "Anchorage", 61.24, -149.89, "Alaska"],
  ["USNYC", "New York and New Jersey", 40.68, -74.15, "Newark Elizabeth"],
  ["USBOS", "Boston", 42.35, -71.04],
  ["USPHL", "Philadelphia", 39.9, -75.14],
  ["USBAL", "Baltimore", 39.25, -76.55],
  ["USORF", "Norfolk", 36.9, -76.33, "Virginia Hampton Roads"],
  ["USILM", "Wilmington (NC)", 34.2, -77.95],
  ["USCHS", "Charleston", 32.84, -79.89],
  ["USSAV", "Savannah", 32.12, -81.14, "Garden City"],
  ["USJAX", "Jacksonville", 30.4, -81.55],
  ["USPEF", "Port Everglades", 26.09, -80.12, "Fort Lauderdale"],
  ["USMIA", "Miami", 25.77, -80.17],
  ["USMOB", "Mobile", 30.69, -88.04, "Alabama"],
  ["USMSY", "New Orleans", 29.93, -90.06],
  ["USHOU", "Houston", 29.68, -95.01, "Bayport Barbours Cut"],
  ["CAVAN", "Vancouver", 49.29, -123.08, "Deltaport"],
  ["CAPRR", "Prince Rupert", 54.3, -130.35],
  ["CAMTR", "Montreal", 45.55, -73.53, "Montréal"],
  ["CAHAL", "Halifax", 44.63, -63.56],
  ["MXZLO", "Manzanillo (MX)", 19.06, -104.3],
  ["MXLZC", "Lázaro Cárdenas", 17.94, -102.18, "Lazaro Cardenas"],
  ["MXVER", "Veracruz", 19.21, -96.13],
  ["MXATM", "Altamira", 22.48, -97.87],
  // Central America and the Caribbean
  ["GTSTC", "Santo Tomás de Castilla", 15.7, -88.62, "Santo Tomas Guatemala"],
  ["HNPCR", "Puerto Cortés", 15.84, -87.94, "Puerto Cortes Honduras"],
  ["CRMOB", "Moín", 10.01, -83.08, "Moin Limon Costa Rica"],
  ["PAMIT", "Manzanillo (PA)", 9.37, -79.88, "Colón MIT Panama"],
  ["PAONX", "Colón", 9.35, -79.9, "Colon Cristobal Panama"],
  ["PABLB", "Balboa", 8.95, -79.57, "Panama"],
  ["JMKIN", "Kingston", 17.97, -76.85, "Jamaica"],
  ["BSFPO", "Freeport", 26.52, -78.77, "Bahamas"],
  ["DOCAU", "Caucedo", 18.42, -69.63, "Santo Domingo"],
  ["PRSJU", "San Juan", 18.43, -66.1, "Puerto Rico"],
  ["TTPOS", "Port of Spain", 10.65, -61.52, "Trinidad"],
  // South America
  ["COCTG", "Cartagena", 10.4, -75.53],
  ["COSMR", "Santa Marta", 11.25, -74.22],
  ["COBUN", "Buenaventura", 3.89, -77.08],
  ["VEPBL", "Puerto Cabello", 10.48, -68.01],
  ["ECGYE", "Guayaquil", -2.28, -79.91],
  ["ECPSJ", "Posorja", -2.7, -80.25],
  ["PECLL", "Callao", -12.05, -77.15, "Lima"],
  ["CLSAI", "San Antonio", -33.59, -71.62],
  ["CLVAP", "Valparaíso", -33.03, -71.63, "Valparaiso"],
  ["BRSSZ", "Santos", -23.96, -46.31, "São Paulo"],
  ["BRRIO", "Rio de Janeiro", -22.89, -43.2],
  ["BRPNG", "Paranaguá", -25.5, -48.52, "Paranagua"],
  ["BRITJ", "Itajaí", -26.9, -48.66, "Itajai Navegantes"],
  ["BRRIG", "Rio Grande", -32.12, -52.1],
  ["BRSSA", "Salvador", -12.96, -38.51, "Bahia"],
  ["BRSUA", "Suape", -8.4, -34.97, "Recife"],
  ["BRPEC", "Pecém", -3.54, -38.81, "Pecem Fortaleza"],
  ["UYMVD", "Montevideo", -34.9, -56.21],
  ["ARBUE", "Buenos Aires", -34.58, -58.37],
  // Oceania
  ["AUMEL", "Melbourne", -37.83, 144.92],
  ["AUSYD", "Sydney", -33.97, 151.22, "Port Botany"],
  ["AUBNE", "Brisbane", -27.38, 153.17],
  ["AUFRE", "Fremantle", -32.05, 115.74, "Perth"],
  ["AUADL", "Adelaide", -34.8, 138.5],
  ["NZAKL", "Auckland", -36.84, 174.78],
  ["NZTRG", "Tauranga", -37.65, 176.18],
  ["NZLYT", "Lyttelton", -43.61, 172.72, "Christchurch"],
  ["FJSUV", "Suva", -18.13, 178.42, "Fiji"],
  ["PGPOM", "Port Moresby", -9.46, 147.15, "Papua New Guinea"],
];

export const PORTS: Port[] = ROWS.map(([code, name, lat, lon, aka]) => ({ code, name, country: code.slice(0, 2), lat, lon, aka }));

const byCode = new Map(PORTS.map((p) => [p.code, p]));

export const findPort = (code: string): Port | undefined => byCode.get(code.toUpperCase());

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/** "Singapore" for SG, "India" for IN; the code itself when the runtime has no region names. */
export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Ports matching a query on name, other names, UN/LOCODE or country, best first: a name or code starting with
 * the query ranks above a match inside a word, which ranks above a country match.
 */
export function searchPorts(query: string, limit = 8): Port[] {
  const q = fold(query.trim());
  if (!q) return PORTS.slice(0, limit);
  const scored: { p: Port; s: number }[] = [];
  for (const p of PORTS) {
    const name = fold(p.name), aka = fold(p.aka ?? ""), code = p.code.toLowerCase(), country = fold(countryName(p.country));
    let s = 0;
    if (code === q || name === q) s = 100;
    else if (name.startsWith(q) || code.startsWith(q)) s = 80;
    else if (aka.split(/\s+/).some((w) => w.startsWith(q)) || name.split(/[\s-]+/).some((w) => w.startsWith(q))) s = 60;
    else if (name.includes(q) || aka.includes(q)) s = 40;
    else if (country.startsWith(q) || p.country.toLowerCase() === q) s = 30;
    else if (country.includes(q)) s = 20;
    if (s) scored.push({ p, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((x) => x.p);
}

/** The port nearest to a position, if one lies within `maxKm`. */
export function nearestPort(lat: number, lon: number, maxKm = 40): Port | undefined {
  let best: Port | undefined;
  let bestKm = maxKm;
  for (const p of PORTS) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d <= bestKm) {
      best = p;
      bestKm = d;
    }
  }
  return best;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
