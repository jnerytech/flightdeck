/**
 * Pairing's public entry (#1594): how the app reaches this daemon the first time. The address put
 * in the pairing link, its QR code, the Tailscale IP and the token rotation. Another domain
 * imports from here, never a file inside.
 */
export { loopbackOnly, pairingAddress, renderQr, rotateToken, tailscaleIp } from "./pairing.ts";
