import { Form, useLoaderData } from "react-router";

type LoaderData = {
  error: string | null;
  needsLogin: boolean;
  authorizationId: string | null;
  clientName: string | null;
  redirectUri: string | null;
  scopes: string[];
};

export function Component() {
  const data = useLoaderData() as LoaderData;

  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground">Post for Me</p>
          <h1 className="mt-2 text-2xl font-semibold">Autorizar acesso</h1>
        </div>

        {data.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {data.error}
          </div>
        ) : data.needsLogin ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Você precisa estar autenticado no Post for Me para aprovar esta conexão.
            </p>
            <a
              href="/sign-in"
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Entrar em outra aba
            </a>
            <p className="text-xs text-muted-foreground">
              Depois de entrar, volte para esta aba e recarregue a página.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3 text-sm">
              <p>
                <strong>{data.clientName ?? "ChatGPT"}</strong> quer acessar sua conta do Post for Me.
              </p>

              {data.scopes.length > 0 && (
                <div>
                  <p className="mb-2 font-medium">Permissões solicitadas</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {data.scopes.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.redirectUri && (
                <p className="break-all text-xs text-muted-foreground">
                  Retorno: {data.redirectUri}
                </p>
              )}
            </div>

            <Form method="post" className="flex gap-3">
              <input
                type="hidden"
                name="authorization_id"
                value={data.authorizationId ?? ""}
              />
              <button
                type="submit"
                name="decision"
                value="approve"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Autorizar
              </button>
              <button
                type="submit"
                name="decision"
                value="deny"
                className="rounded-md border px-4 py-2 text-sm font-medium"
              >
                Negar
              </button>
            </Form>
          </div>
        )}
      </div>
    </main>
  );
}
