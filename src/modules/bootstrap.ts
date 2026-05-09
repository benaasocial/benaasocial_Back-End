import { Application, Router } from "express";
import authRouter from "./auth/router";
import userRouter from "./user/router";
import postsRouter from "./posts/router";
import integrationsRouter from "./integrations/router";



const bootstrap = (app: Application) => {
    const api = Router();

    api.get("/", (_req, res) => {
        res.status(200).json({ ok: true, status: 200, data: { service: "api", up: true } });
    });

    api.use("/auth", authRouter);
    api.use("/users", userRouter);
    api.use("/posts", postsRouter);
    api.use("/integrations", integrationsRouter);

    app.use("/api/v1", api);
}





export default bootstrap;