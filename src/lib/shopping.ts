/**
 * Serviços da lista de compras (server-only) — compartilhados pelas rotas REST
 * (/api/shopping/**) e pelo servidor MCP (/api/mcp).
 */
import type { ShoppingItem as PrismaShoppingItem } from "@/generated/prisma/client";
import {
  DEFAULT_PLACES,
  MAX_ITEMS_PER_PLACE,
  MAX_PLACES,
  findDuplicateItem,
  normalizeKey,
  splitPlaceItems,
  validateItemName,
  validateItemQuantity,
  validatePlaceName,
  type ShoppingItemDTO,
  type ShoppingPayload,
  type ShoppingPlaceDTO,
} from "./domain/shopping";
import { prisma } from "./prisma";

export type ShoppingFailure = { ok: false; status: number; message: string };
export type ShoppingResult<T> = { ok: true; data: T } | ShoppingFailure;

function toItemDTO(item: PrismaShoppingItem): ShoppingItemDTO {
  return {
    id: item.id,
    placeId: item.placeId,
    name: item.name,
    quantity: item.quantity ?? null,
    checked: item.checked,
    addedAt: item.addedAt.toISOString(),
    checkedAt: item.checkedAt ? item.checkedAt.toISOString() : null,
  };
}

function findItemInPayload(payload: ShoppingPayload, itemId: string): ShoppingItemDTO {
  for (const place of payload.places) {
    const found = place.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  throw new Error(`ShoppingItem ${itemId} não encontrado após gravação.`);
}

export async function getShoppingPayload(userId: string): Promise<ShoppingPayload> {
  const places = await prisma.shoppingPlace.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { items: true },
  });

  return {
    places: places.map((place) => {
      const { unchecked, checked } = splitPlaceItems(place.items.map(toItemDTO));
      return {
        id: place.id,
        name: place.name,
        position: place.position,
        items: [...unchecked, ...checked],
      };
    }),
  };
}

export async function createShoppingPlace(
  userId: string,
  body: { name?: unknown },
): Promise<ShoppingResult<{ place: ShoppingPlaceDTO; shopping: ShoppingPayload }>> {
  const nameRes = validatePlaceName(body.name);
  if (!nameRes.ok) return { ok: false, status: 400, message: nameRes.message };

  const existing = await prisma.shoppingPlace.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  if (existing.length >= MAX_PLACES) {
    return { ok: false, status: 400, message: `Máximo de ${MAX_PLACES} locais atingido.` };
  }

  const key = normalizeKey(nameRes.data);
  if (existing.some((p) => normalizeKey(p.name) === key)) {
    return { ok: false, status: 409, message: "Já existe um local com esse nome." };
  }

  const position = existing.length > 0 ? Math.max(...existing.map((p) => p.position)) + 1 : 0;
  const created = await prisma.shoppingPlace.create({
    data: { userId, name: nameRes.data, position },
  });

  const shopping = await getShoppingPayload(userId);
  const place = shopping.places.find((p) => p.id === created.id) ?? {
    id: created.id,
    name: created.name,
    position: created.position,
    items: [],
  };
  return { ok: true, data: { place, shopping } };
}

export async function seedDefaultPlaces(userId: string): Promise<ShoppingResult<ShoppingPayload>> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.shoppingPlace.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const keys = new Set(existing.map((p) => normalizeKey(p.name)));
    let nextPos = existing.length > 0 ? Math.max(...existing.map((p) => p.position)) + 1 : 0;
    let total = existing.length;

    for (const name of DEFAULT_PLACES) {
      if (keys.has(normalizeKey(name))) continue;
      if (total >= MAX_PLACES) break;
      await tx.shoppingPlace.create({
        data: { userId, name, position: nextPos },
      });
      nextPos += 1;
      total += 1;
    }
  });

  return { ok: true, data: await getShoppingPayload(userId) };
}

export async function updateShoppingPlace(
  userId: string,
  placeId: string,
  body: { name?: unknown; position?: unknown },
): Promise<ShoppingResult<{ place: ShoppingPlaceDTO; shopping: ShoppingPayload }>> {
  const current = await prisma.shoppingPlace.findUnique({ where: { id: placeId } });
  if (!current || current.userId !== userId) {
    return { ok: false, status: 404, message: "Local não encontrado." };
  }

  let nextName: string | undefined;
  if (body.name !== undefined) {
    const nameRes = validatePlaceName(body.name);
    if (!nameRes.ok) return { ok: false, status: 400, message: nameRes.message };
    nextName = nameRes.data;
  }

  let nextPosition: number | undefined;
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 0) {
      return { ok: false, status: 400, message: "Posição deve ser um número inteiro ≥ 0." };
    }
    nextPosition = body.position;
  }

  if (nextName !== undefined) {
    const siblings = await prisma.shoppingPlace.findMany({
      where: { userId, id: { not: placeId } },
      select: { name: true },
    });
    const key = normalizeKey(nextName);
    if (siblings.some((p) => normalizeKey(p.name) === key)) {
      return { ok: false, status: 409, message: "Já existe um local com esse nome." };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (nextPosition !== undefined) {
      const all = await tx.shoppingPlace.findMany({
        where: { userId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });
      const without = all.filter((p) => p.id !== placeId);
      const targetIndex = Math.max(0, Math.min(without.length, nextPosition));
      const reordered = [
        ...without.slice(0, targetIndex),
        current,
        ...without.slice(targetIndex),
      ];
      for (let i = 0; i < reordered.length; i += 1) {
        const entry = reordered[i];
        const shouldRename = entry.id === placeId && nextName !== undefined;
        if (entry.position !== i || shouldRename) {
          await tx.shoppingPlace.update({
            where: { id: entry.id },
            data: {
              position: i,
              ...(shouldRename ? { name: nextName } : {}),
            },
          });
        }
      }
    } else if (nextName !== undefined) {
      await tx.shoppingPlace.update({
        where: { id: placeId },
        data: { name: nextName },
      });
    }
  });

  const shopping = await getShoppingPayload(userId);
  const place = shopping.places.find((p) => p.id === placeId);
  if (!place) return { ok: false, status: 404, message: "Local não encontrado." };
  return { ok: true, data: { place, shopping } };
}

export async function deleteShoppingPlace(
  userId: string,
  placeId: string,
): Promise<ShoppingResult<ShoppingPayload>> {
  const place = await prisma.shoppingPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) {
    return { ok: false, status: 404, message: "Local não encontrado." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.shoppingPlace.delete({ where: { id: placeId } });
    const remaining = await tx.shoppingPlace.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    for (let i = 0; i < remaining.length; i += 1) {
      if (remaining[i].position !== i) {
        await tx.shoppingPlace.update({
          where: { id: remaining[i].id },
          data: { position: i },
        });
      }
    }
  });

  return { ok: true, data: await getShoppingPayload(userId) };
}

export async function checkAllInPlace(
  userId: string,
  placeId: string,
): Promise<ShoppingResult<ShoppingPayload>> {
  const place = await prisma.shoppingPlace.findUnique({ where: { id: placeId } });
  if (!place || place.userId !== userId) {
    return { ok: false, status: 404, message: "Local não encontrado." };
  }

  await prisma.shoppingItem.updateMany({
    where: { placeId, userId, checked: false },
    data: { checked: true, checkedAt: new Date() },
  });

  return { ok: true, data: await getShoppingPayload(userId) };
}

export async function addShoppingItem(
  userId: string,
  body: { placeId?: unknown; name?: unknown; quantity?: unknown },
): Promise<
  ShoppingResult<{
    item: ShoppingItemDTO;
    reactivated: boolean;
    alreadyPending: boolean;
    shopping: ShoppingPayload;
  }>
> {
  if (typeof body.placeId !== "string" || !body.placeId.trim()) {
    return { ok: false, status: 400, message: "Informe o local da compra." };
  }
  const place = await prisma.shoppingPlace.findUnique({
    where: { id: body.placeId },
    include: { items: true },
  });
  if (!place || place.userId !== userId) {
    return { ok: false, status: 404, message: "Local não encontrado." };
  }

  const nameRes = validateItemName(body.name);
  if (!nameRes.ok) return { ok: false, status: 400, message: nameRes.message };

  const qtyRes = validateItemQuantity(body.quantity);
  if (!qtyRes.ok) return { ok: false, status: 400, message: qtyRes.message };

  const existingDTOs = place.items.map(toItemDTO);
  const dup = findDuplicateItem(existingDTOs, nameRes.data);

  if (dup) {
    if (dup.checked) {
      await prisma.shoppingItem.update({
        where: { id: dup.id },
        data: {
          checked: false,
          addedAt: new Date(),
          checkedAt: null,
          ...(qtyRes.data !== null ? { quantity: qtyRes.data } : {}),
        },
      });
      const shopping = await getShoppingPayload(userId);
      return {
        ok: true,
        data: {
          item: findItemInPayload(shopping, dup.id),
          reactivated: true,
          alreadyPending: false,
          shopping,
        },
      };
    }

    if (qtyRes.data !== null && qtyRes.data !== dup.quantity) {
      await prisma.shoppingItem.update({
        where: { id: dup.id },
        data: { quantity: qtyRes.data },
      });
    }
    const shopping = await getShoppingPayload(userId);
    return {
      ok: true,
      data: {
        item: findItemInPayload(shopping, dup.id),
        reactivated: false,
        alreadyPending: true,
        shopping,
      },
    };
  }

  if (place.items.length >= MAX_ITEMS_PER_PLACE) {
    return {
      ok: false,
      status: 400,
      message: `Máximo de ${MAX_ITEMS_PER_PLACE} itens neste local atingido.`,
    };
  }

  const created = await prisma.shoppingItem.create({
    data: {
      placeId: place.id,
      userId,
      name: nameRes.data,
      quantity: qtyRes.data,
      checked: false,
      addedAt: new Date(),
      checkedAt: null,
    },
  });

  const shopping = await getShoppingPayload(userId);
  return {
    ok: true,
    data: {
      item: findItemInPayload(shopping, created.id),
      reactivated: false,
      alreadyPending: false,
      shopping,
    },
  };
}

export async function updateShoppingItem(
  userId: string,
  itemId: string,
  body: { name?: unknown; quantity?: unknown; checked?: unknown; placeId?: unknown },
): Promise<ShoppingResult<{ item: ShoppingItemDTO; shopping: ShoppingPayload }>> {
  const current = await prisma.shoppingItem.findUnique({ where: { id: itemId } });
  if (!current || current.userId !== userId) {
    return { ok: false, status: 404, message: "Item não encontrado." };
  }

  let targetPlaceId = current.placeId;
  if (body.placeId !== undefined) {
    if (typeof body.placeId !== "string" || !body.placeId.trim()) {
      return { ok: false, status: 400, message: "Local inválido." };
    }
    const targetPlace = await prisma.shoppingPlace.findUnique({ where: { id: body.placeId } });
    if (!targetPlace || targetPlace.userId !== userId) {
      return { ok: false, status: 404, message: "Local não encontrado." };
    }
    targetPlaceId = targetPlace.id;
  }

  let nextName = current.name;
  if (body.name !== undefined) {
    const nameRes = validateItemName(body.name);
    if (!nameRes.ok) return { ok: false, status: 400, message: nameRes.message };
    nextName = nameRes.data;
  }

  if (targetPlaceId !== current.placeId || body.name !== undefined) {
    const targetPlace = await prisma.shoppingPlace.findUnique({
      where: { id: targetPlaceId },
      include: { items: true },
    });
    if (!targetPlace) {
      return { ok: false, status: 404, message: "Local não encontrado." };
    }
    if (targetPlaceId !== current.placeId && targetPlace.items.length >= MAX_ITEMS_PER_PLACE) {
      return {
        ok: false,
        status: 400,
        message: `Máximo de ${MAX_ITEMS_PER_PLACE} itens em ${targetPlace.name} atingido.`,
      };
    }
    const dup = findDuplicateItem(targetPlace.items.map(toItemDTO), nextName, current.id);
    if (dup) {
      return {
        ok: false,
        status: 409,
        message: `Já existe "${dup.name}" em ${targetPlace.name}.`,
      };
    }
  }

  let quantityData: { quantity?: string | null } = {};
  if ("quantity" in body && body.quantity !== undefined) {
    const qtyRes = validateItemQuantity(body.quantity);
    if (!qtyRes.ok) return { ok: false, status: 400, message: qtyRes.message };
    quantityData = { quantity: qtyRes.data };
  }

  let checkedData: { checked?: boolean; addedAt?: Date; checkedAt?: Date | null } = {};
  if (body.checked !== undefined) {
    if (typeof body.checked !== "boolean") {
      return { ok: false, status: 400, message: "checked deve ser booleano." };
    }
    if (body.checked !== current.checked) {
      checkedData = body.checked
        ? { checked: true, checkedAt: new Date() }
        : { checked: false, addedAt: new Date(), checkedAt: null };
    }
  }

  await prisma.shoppingItem.update({
    where: { id: itemId },
    data: {
      ...(targetPlaceId !== current.placeId ? { placeId: targetPlaceId } : {}),
      ...(body.name !== undefined ? { name: nextName } : {}),
      ...quantityData,
      ...checkedData,
    },
  });

  const shopping = await getShoppingPayload(userId);
  return {
    ok: true,
    data: {
      item: findItemInPayload(shopping, itemId),
      shopping,
    },
  };
}

export async function deleteShoppingItem(
  userId: string,
  itemId: string,
): Promise<ShoppingResult<ShoppingPayload>> {
  const item = await prisma.shoppingItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    return { ok: false, status: 404, message: "Item não encontrado." };
  }

  await prisma.shoppingItem.delete({ where: { id: itemId } });
  return { ok: true, data: await getShoppingPayload(userId) };
}
