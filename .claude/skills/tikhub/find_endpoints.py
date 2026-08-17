#!/usr/bin/env python3
"""Search the TikHub OpenAPI spec for endpoints.

Usage:
  find_endpoints.py <openapi.json> <keyword> [keyword ...]   # AND-match on path+summary
  find_endpoints.py <openapi.json> -d <exact-path>           # full detail incl. body schema
"""
import json
import sys


def resolve(spec, ref):
    node = spec
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


def brief(method, path, op):
    return f"{method.upper()} {path} | {op.get('summary', '')}"


def detail(spec, method, path, op):
    print(brief(method, path, op))
    for q in op.get("parameters", []):
        req = "required" if q.get("required") else "optional"
        default = q.get("schema", {}).get("default")
        default = "" if default is None else f" default={default!r}"
        desc = (q.get("description") or q.get("schema", {}).get("description") or "").split("\n")[0]
        print(f"  query {q['name']} ({req}){default}  {desc[:80]}")
    body = op.get("requestBody")
    if body:
        schema = body["content"]["application/json"]["schema"]
        if "$ref" in schema:
            schema = resolve(spec, schema["$ref"])
        print("  JSON body:")
        required = set(schema.get("required", []))
        for name, prop in schema.get("properties", {}).items():
            req = "required" if name in required else "optional"
            default = prop.get("default")
            default = "" if default is None else f" default={default!r}"
            desc = (prop.get("description") or "").split("\n")[0]
            print(f"    {name} ({prop.get('type', '?')}, {req}){default}  {desc[:80]}")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    spec = json.load(open(sys.argv[1]))
    if sys.argv[2] == "-d":
        target = sys.argv[3]
        ops = spec["paths"].get(target)
        if not ops:
            sys.exit(f"no such path: {target}")
        for method, op in ops.items():
            detail(spec, method, target, op)
        return
    terms = [t.lower() for t in sys.argv[2:]]
    hits = 0
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            hay = (path + " " + op.get("summary", "")).lower()
            if all(t in hay for t in terms):
                print(brief(method, path, op))
                hits += 1
    print(f"-- {hits} endpoints matched (of {len(spec['paths'])})", file=sys.stderr)


if __name__ == "__main__":
    main()
