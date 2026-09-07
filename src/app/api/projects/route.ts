import { projectSummary } from "@/modules/analysis";
import { listProjects } from "@/modules/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await listProjects();
  const withSummaries = await Promise.all(
    projects.map(async (project) => ({
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      summary: await projectSummary(project.id),
    })),
  );

  return Response.json({ projects: withSummaries });
}
