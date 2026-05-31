/**
 * 项目路由（U6）。创建（创建者即 owner）/ 列出我的 / 加成员（owner）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { authenticate, getUser, requireProjectRole } from "../middleware/auth.ts";
import type { Role } from "../services/rbac.ts";
import { config } from "../config.ts";
import { validateGitUrl, validateLocalDir, type LinkMode } from "../services/git-link.ts";
import { exportProject, importProject, validateBundle, MAX_BUNDLE_BYTES } from "../services/project-export.ts";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.post("/api/projects", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: "BAD_REQUEST", message: "name 必填" });
    const res = await db.execute(sql`
      INSERT INTO projects (name, owner_id) VALUES (${name}, ${user.userId}) RETURNING id`);
    const projectId = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;
    return reply.code(201).send({ projectId, name });
  });

  app.get("/api/projects", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const res = await db.execute(sql`
      SELECT DISTINCT p.id, p.name
        FROM projects p
        LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${user.userId}
       WHERE p.owner_id = ${user.userId} OR m.user_id IS NOT NULL
       ORDER BY p.id`);
    return reply.send({ projects: (res as unknown as { rows: unknown[] }).rows });
  });

  app.post(
    "/api/projects/:id/members",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      const { userId, role } = (req.body ?? {}) as { userId?: string; role?: Role };
      if (!userId || !role) return reply.code(400).send({ error: "BAD_REQUEST" });
      try {
        await db.execute(sql`
          INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${userId}, ${role}::member_role)`);
      } catch {
        return reply.code(409).send({ error: "ALREADY_MEMBER" });
      }
      return reply.code(201).send({ projectId, userId, role });
    },
  );

  // R5 export：打包 project 为可移植 JSON bundle（owner only）。
  app.get(
    "/api/projects/:id/export",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      return reply.send(await exportProject(db, projectId));
    },
  );

  // R5 import：在本实例重建 project，归属导入者（owner 重映射，E 簇）。需登录；bundle 强校验。
  // bodyLimit 抬到 10MB（默认 1MB 不够），超限 Fastify 413 兜底；validateBundle 再精校。
  app.post(
    "/api/projects/import",
    { preHandler: authenticate, bodyLimit: MAX_BUNDLE_BYTES + 1024 },
    async (req, reply) => {
      const user = getUser(req)!;
      const raw = req.body;
      const v = validateBundle(raw, Buffer.byteLength(JSON.stringify(raw ?? null), "utf8"));
      if (!v.ok || !v.bundle) return reply.code(422).send({ error: "INVALID_BUNDLE", message: v.error });
      const projectId = await importProject(db, user.userId, v.bundle);
      return reply.code(201).send({ projectId, name: v.bundle.project.name });
    },
  );

  // U4 Git-linked：链接外部 repo。owner only。两路径强制分流（C 簇）：
  // localDir 仅本地模式（团队拒——服务端访问不到成员笔记本）；gitUrl 团队/本地皆可。
  app.patch(
    "/api/projects/:id/git-link",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      const { linkMode, gitUrl, localBaseDir } = (req.body ?? {}) as {
        linkMode?: LinkMode;
        gitUrl?: string;
        localBaseDir?: string;
      };
      if (linkMode !== "gitUrl" && linkMode !== "localDir") {
        return reply.code(400).send({ error: "BAD_REQUEST", message: "linkMode 仅 gitUrl|localDir" });
      }

      if (linkMode === "localDir") {
        if (config.mode !== "local") {
          return reply.code(400).send({
            error: "LOCAL_DIR_TEAM_REJECTED",
            message: "团队模式不支持 local_base_dir（服务端访问不到本地路径），请用 gitUrl",
          });
        }
        if (!localBaseDir) return reply.code(400).send({ error: "BAD_REQUEST", message: "localBaseDir 必填" });
        const v = await validateLocalDir(localBaseDir);
        if (!v.ok) return reply.code(422).send({ error: "INVALID_LOCAL_DIR", message: v.error });
        await db.execute(sql`
          UPDATE projects SET link_mode = 'localDir', local_base_dir = ${v.resolvedDir}, git_url = NULL
           WHERE id = ${projectId}`);
        return reply.send({ projectId, linkMode, localBaseDir: v.resolvedDir });
      }

      // gitUrl
      if (!gitUrl) return reply.code(400).send({ error: "BAD_REQUEST", message: "gitUrl 必填" });
      const v = validateGitUrl(gitUrl);
      if (!v.ok) return reply.code(422).send({ error: "INVALID_GIT_URL", message: v.error });
      await db.execute(sql`
        UPDATE projects SET link_mode = 'gitUrl', git_url = ${gitUrl}, local_base_dir = NULL
         WHERE id = ${projectId}`);
      return reply.send({ projectId, linkMode, gitUrl });
    },
  );
}
