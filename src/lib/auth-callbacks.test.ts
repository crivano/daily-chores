import { beforeEach, describe, expect, it, vi } from "vitest";
import { googleSubOf, jwtCallback, sessionCallback, signInCallback } from "./auth-callbacks";
import { prisma } from "./prisma";

vi.mock("./prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const dbUser = { id: "user-1", email: "a@b.com", name: "A", timezone: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("googleSubOf", () => {
  it("prefere profile.sub (OIDC) e ignora o UUID aleatório de user.id", () => {
    expect(googleSubOf({ sub: "g-sub" } as never, null)).toBe("g-sub");
    expect(googleSubOf(undefined, { providerAccountId: "acc-1" } as never)).toBe("acc-1");
    expect(googleSubOf({ sub: 123 } as never, null)).toBeNull();
    expect(googleSubOf(undefined, null)).toBeNull();
  });
});

describe("jwtCallback", () => {
  it("no sign-in resolve pelo profile.sub, não pelo token.sub (UUID aleatório do v5)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    const token = await jwtCallback({
      // Reproduz o bug: token.sub/user.id são um UUID aleatório no beta.32.
      token: { sub: "uuid-aleatorio", email: "a@b.com" } as never,
      user: { id: "uuid-aleatorio", email: "a@b.com" } as never,
      account: { providerAccountId: "g-sub" } as never,
      profile: { sub: "g-sub" } as never,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { googleSub: "g-sub" } });
    expect(token.uid).toBe("user-1");
  });

  it("sem profile, usa account.providerAccountId; sem ambos, cai no e-mail", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(dbUser as never);
    const token = await jwtCallback({
      token: { sub: "uuid", email: "a@b.com" } as never,
      user: { id: "uuid", email: "a@b.com" } as never,
      account: { providerAccountId: "g-sub" } as never,
      profile: undefined,
    });
    // 1ª busca por googleSub (do account) falha → 2ª por e-mail resolve.
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, { where: { googleSub: "g-sub" } });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, { where: { email: "a@b.com" } });
    expect(token.uid).toBe("user-1");
  });

  it("auto-recupera cookies antigos sem uid (request sem user, token com e-mail)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    const token = await jwtCallback({ token: { sub: "x", email: "a@b.com" } as never });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
    expect(token.uid).toBe("user-1");
  });

  it("não consulta o banco quando o token já tem uid", async () => {
    const token = await jwtCallback({ token: { sub: "x", email: "a@b.com", uid: "user-1" } as never });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(token.uid).toBe("user-1");
  });
});

describe("signInCallback", () => {
  it("faz upsert com o googleSub real do profile", async () => {
    vi.mocked(prisma.user.upsert).mockResolvedValue(dbUser as never);
    const ok = await signInCallback({
      user: { id: "uuid-aleatorio", email: "a@b.com", name: "A" } as never,
      account: { providerAccountId: "g-sub" } as never,
      profile: { sub: "g-sub" } as never,
    });
    expect(ok).toBe(true);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { googleSub: "g-sub" },
      update: { email: "a@b.com", name: "A" },
      create: { googleSub: "g-sub", email: "a@b.com", name: "A" },
    });
  });

  it("recusa quando falta sub ou e-mail", async () => {
    expect(
      await signInCallback({ user: { email: "a@b.com" }, account: null, profile: undefined }),
    ).toBe(false);
    expect(
      await signInCallback({
        user: { email: null, name: "A" },
        account: { providerAccountId: "g" } as never,
        profile: { sub: "g" } as never,
      }),
    ).toBe(false);
  });

  it("em conflito de e-mail único, vincula o googleSub na conta existente", async () => {
    vi.mocked(prisma.user.upsert).mockRejectedValue(new Error("unique") as never);
    vi.mocked(prisma.user.update).mockResolvedValue(dbUser as never);
    const ok = await signInCallback({
      user: { id: "uuid", email: "a@b.com", name: "A" } as never,
      account: null,
      profile: { sub: "g-sub" } as never,
    });
    expect(ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: "a@b.com" },
      data: { googleSub: "g-sub" },
    });
  });
});

describe("sessionCallback", () => {
  it("copia token.uid para session.user.id", () => {
    const session = { user: { name: "A", email: "a@b.com" }, expires: "" } as never;
    const result = sessionCallback({ session, token: { uid: "user-1" } as never });
    expect(result.user.id).toBe("user-1");
  });

  it("mantém a sessão intacta quando não há uid", () => {
    const session = { user: { name: "A", email: "a@b.com" }, expires: "" } as never;
    const result = sessionCallback({ session, token: {} as never });
    expect(result.user.id).toBeUndefined();
  });
});
