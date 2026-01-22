// Minimal ESM-friendly path shim for node:path default import
const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const resolve = (...parts) => join(...parts);
const dirname = (p = "") => {
  const out = p.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
  return out || "/";
};
const basename = (p = "") => p.replace(/\/+$/, "").split("/").pop() || "";
const extname = (p = "") => {
  const match = /\.[^./]+$/.exec(p);
  return match ? match[0] : "";
};

const pathShim = { join, resolve, dirname, basename, extname };

// Support both default and CJS interop patterns
export default pathShim;
export { join, resolve, dirname, basename, extname };
// Provide CommonJS interop for libraries expecting module.exports
// @ts-ignore
module.exports = pathShim;
