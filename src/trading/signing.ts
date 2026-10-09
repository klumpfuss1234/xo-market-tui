import { randomBytes } from "node:crypto";
import { TypedDataEncoder, Wallet, getAddress } from "ethers";
import { XO } from "../constants.js";
import type { OrderDraft, WalletSession } from "../types.js";
import { amountsFor } from "./units.js";

const ZERO_BYTES16 = `0x${"0".repeat(32)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export interface UnsignedOrder {
  salt: bigint;
  maker: string;
  signer: string;
  beneficiary: string;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  expiration: bigint;
  nonce: bigint;
  identifier: string;
  metadata: string;
  side: 0 | 1;
  signatureType: 3;
}

export const orderTypes = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "beneficiary", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint128" },
    { name: "identifier", type: "bytes16" },
    { name: "metadata", type: "bytes32" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" }
  ]
};

const kernelTypes = { Kernel: [{ name: "hash", type: "bytes32" }] };

function orderDomain() {
  return { name: "XO Market CLOB", version: "1", chainId: XO.chainId, verifyingContract: XO.ctfExchange };
}

function kernelDomain(smartAccount: string) {
  return { name: "Kernel", version: "0.3.1", chainId: XO.chainId, verifyingContract: smartAccount };
}

export function buildUnsignedOrder(draft: OrderDraft, smartAccount: string): UnsignedOrder {
  const account = getAddress(smartAccount);
  const amounts = amountsFor(draft.side, draft.price, draft.shares);
  if (draft.timeInForce === "GTD" && (!draft.expiration || draft.expiration <= Date.now() / 1000)) {
    throw new Error("GTD requires a future expiration");
  }
  return {
    salt: BigInt(`0x${randomBytes(32).toString("hex")}`),
    maker: account,
    signer: account,
    beneficiary: XO.zeroAddress,
    tokenId: BigInt(draft.tokenId),
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    expiration: BigInt(draft.expiration ?? 0),
    nonce: 0n,
    identifier: ZERO_BYTES16,
    metadata: ZERO_BYTES32,
    side: draft.side === "BUY" ? 0 : 1,
    signatureType: XO.signatureType
  };
}

export async function signOrder(order: UnsignedOrder, session: WalletSession): Promise<string> {
  const owner = new Wallet(session.ownerPrivateKey);
  const digest = TypedDataEncoder.hash(orderDomain(), orderTypes, order);
  const raw = await owner.signTypedData(kernelDomain(getAddress(session.smartAccount)), kernelTypes, { hash: digest });
  return `0x00${raw.slice(2)}`;
}

export function serializeOrder(order: UnsignedOrder, signature: string): Record<string, string | number> {
  return {
    salt: order.salt.toString(), maker: order.maker, signer: order.signer,
    beneficiary: order.beneficiary, tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(), takerAmount: order.takerAmount.toString(),
    expiration: order.expiration.toString(), nonce: order.nonce.toString(),
    identifier: order.identifier, metadata: order.metadata, side: order.side,
    signatureType: order.signatureType, signature
  };
}
