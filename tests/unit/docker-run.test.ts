import { describe, expect, it } from "vitest";
import { parseDockerRun, detectSourceKind } from "@/lib/parse";

describe("docker run parser", () => {
  it("reads a bare nginx command", () => {
    const parsed = parseDockerRun("docker run nginx");
    expect(parsed.image).toBe("nginx");
    expect(parsed.ports).toEqual([]);
    expect(parsed.privileged).toBe(false);
  });

  it("reads publish, env, volume, and name flags", () => {
    const parsed = parseDockerRun(
      `docker run -d --name web -p 8080:80 -e FOO=bar -v html:/usr/share/nginx/html nginx:1.27`,
    );
    expect(parsed.image).toBe("nginx:1.27");
    expect(parsed.name).toBe("web");
    expect(parsed.ports).toEqual([{ host: "8080", container: 80, protocol: undefined }]);
    expect(parsed.env.FOO).toBe("bar");
    expect(parsed.volumes).toEqual(["html:/usr/share/nginx/html"]);
  });

  it("classifies the four paste shapes", () => {
    expect(detectSourceKind("docker run nginx")).toBe("docker-run");
    expect(detectSourceKind("nginx:alpine")).toBe("image");
    expect(detectSourceKind("https://github.com/nginx/docker-nginx")).toBe("github");
    expect(detectSourceKind("services:\n  web:\n    image: nginx\n")).toBe("compose");
  });
});
