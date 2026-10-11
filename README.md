# Prosperia

Prosperia transforms economic, environmental, and social policy into an interactive and engaging city simulation. Users
can select existing policies currently being implemented in Chapel Hill or propose new policies of their own for the
city. They can then implement them and advance time to see how their decisions shape the city. From median rent and job
growth to traffic congestion and tree cover, the simulation uses historical, economic, and social data to track key
indicators across different aspects of suburban and urban life, making the effects of policy choices more tangible,
accessible, and understandable.

By comparing outcomes against the town's baseline conditions, users can see how individual policies (as well as
combinations of policies) change the city's trajectory over time. They can explore unintended consequences, weigh
competing priorities, and discover how decisions that benefit one area may create challenges in another. Through
experimentation and feedback, Prosperia helps users build an intuitive understanding of policy trade-offs and explore
ways to promote sustainable, equitable, and long-term growth.

## Running it

```sh
cp .env.example .env.local   # every key is optional; see the comments in the file
npm run dev                  # then open http://127.0.0.1:3000/meridian-city/
npm test
```

## Where things are

| Path | What |
| --- | --- |
| `meridian-city/` | The app: the pixel-art Chapel Hill map (`world/`, see [WORLD.md](WORLD.md)), the policy panel, the sim clock and the resident view. |
| `shared/` | The policy simulator, pure and deterministic, shared by the browser and the API. |
| `api/` | Vercel functions: policy card drafting, narration, and the resident chat and bank. |
| `data/` | Chapel Hill baselines, model assumptions, zones, residents and the policy cards. Every number is sourced in [docs/sources.md](docs/sources.md). |
| `docs/` | The policy card spec and design notes. |
| `scripts/`, `tests/` | Data bakes and generators (`npm run …`), and the `node --test` suite. |
