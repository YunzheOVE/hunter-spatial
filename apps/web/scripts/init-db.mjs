import { getDataDirectory, openPanoramaDatabase } from "../server/panorama-store.mjs";

const database = openPanoramaDatabase();
database.close();
console.log(`Database tables ready in ${getDataDirectory()}`);
