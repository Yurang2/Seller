import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
  previewCosting,
  saveCosting,
  snapshotChanged,
  transitionProduct,
  decidePrice,
} from "../services/research";
export const researchRoutes = new Hono<AppEnv>();
researchRoutes.post("/costings/preview", async (c) =>
  c.json(await previewCosting(c.env.DB, await c.req.json())),
);
researchRoutes.post("/costings", async (c) =>
  c.json({ data: await saveCosting(c.env.DB, await c.req.json()) }),
);
researchRoutes.get("/costings/:id", async (c) =>
  c.json(await snapshotChanged(c.env.DB, c.req.param("id"))),
);
researchRoutes.post("/products/:id/transition", async (c) =>
  c.json({
    data: await transitionProduct(
      c.env.DB,
      c.req.param("id"),
      await c.req.json(),
    ),
  }),
);
researchRoutes.post("/products/:id/price-decision", async (c) =>
  c.json({
    data: await decidePrice(c.env.DB, c.req.param("id"), await c.req.json()),
  }),
);
