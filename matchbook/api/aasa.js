// Served at /.well-known/apple-app-site-association so invite links (/j/CODE) and booking links (/b/ID) open the iPhone app when it's installed.
export default function handler(req, res) {
  const team = process.env.APNS_TEAM_ID;
  const bundle = process.env.APNS_BUNDLE_ID || "com.robertfrazee.matchbook";
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  if (!team) { res.statusCode = 404; return res.end("{}"); }
  res.end(JSON.stringify({ applinks: { details: [{ appIDs: [`${team}.${bundle}`], components: [{ "/": "/j/*" }, { "/": "/b/*" }, { "/": "/c/*" }] }] } }));
}
