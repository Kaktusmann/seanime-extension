/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

interface DebridProvider {
    name: string
    apiKey: string
    type: "realdebrid" | "torbox" | "alldebrid" | "premiumize"
}

interface DebridProviders {
    [key: string]: DebridProvider
}

function init() {
    $ui.register((ctx) => {
        // Initialize storage for providers if not exists
        if (!$storage.has("providers")) {
            $storage.set("providers", {})
        }
        if (!$storage.has("activeProvider")) {
            $storage.set("activeProvider", "")
        }

        // Create tray icon
        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Kaktusmann/seanime-extension/refs/heads/main/src/DebridToggle/icon.ico",
            withContent: true,
            width: "400px",
            minHeight: "300px"
        })

        // State management
        const providers = ctx.state<DebridProviders>($storage.get<DebridProviders>("providers") || {})
        const activeProvider = ctx.state<string>($storage.get<string>("activeProvider") || "")
        const showAddForm = ctx.state<boolean>(false)
        const newProviderName = ctx.fieldRef<string>("")
        const newProviderType = ctx.fieldRef<string>("realdebrid")
        const newProviderApiKey = ctx.fieldRef<string>("")
        const status = ctx.state<string>("")

        // Update storage when providers change
        ctx.effect(() => {
            $storage.set("providers", providers.get())
        }, [providers])

        ctx.effect(() => {
            $storage.set("activeProvider", activeProvider.get())
        }, [activeProvider])

        // Function to update Seanime settings using appSettings API
        async function setDebridProvider(provider: DebridProvider) {
            try {
                status.set("Switching to " + provider.name + "...");
                // Get current debrid settings (fallback to empty object)
                const current = await ctx.appSettings.get("debrid", {});
                // Patch only the debrid section
                await ctx.appSettings.patch({
                    debrid: {
                        ...current,
                        enabled: true,
                        provider: provider.type,
                        apiKey: provider.apiKey
                    }
                });
                activeProvider.set(provider.name);
                $storage.set("activeProvider", provider.name);
                status.set("✓ Active: " + provider.name);
                ctx.toast.success("Switched to " + provider.name);
                tray.update();
            } catch (error) {
                status.set("Error: " + $toString(error));
                ctx.toast.error("Failed to switch provider");
                tray.update();
            }
        }

        // Function to add a new provider
        function addProvider() {
            const name = newProviderName.current.trim()
            const type = newProviderType.current as "realdebrid" | "torbox" | "alldebrid" | "premiumize"
            const apiKey = newProviderApiKey.current.trim()

            if (!name || !apiKey) {
                ctx.toast.error("Name and API Key are required")
                return
            }

            const currentProviders = providers.get()
            if (currentProviders[name]) {
                ctx.toast.error("Provider with this name already exists")
                return
            }

            const newProvider: DebridProvider = {
                name,
                type,
                apiKey
            }

            currentProviders[name] = newProvider
            providers.set({ ...currentProviders })
            $storage.set("providers", currentProviders)

            newProviderName.setValue("")
            newProviderApiKey.setValue("")
            showAddForm.set(false)
            ctx.toast.success("Provider added: " + name)
        }

        // Function to delete a provider
        function deleteProvider(name: string) {
            const currentProviders = providers.get()
            delete currentProviders[name]
            providers.set({ ...currentProviders })
            $storage.set("providers", currentProviders)

            if (activeProvider.get() === name) {
                activeProvider.set("")
                $storage.set("activeProvider", "")
                status.set("")
            }

            ctx.toast.info("Provider deleted: " + name)
        }

        // Render function
        tray.render(() => {
            const currentProviders = providers.get()
            const providerKeys = Object.keys(currentProviders)

            // Header
            const header = tray.flex([
                tray.text("Debrid Toggle", { style: { fontSize: "20px", fontWeight: "bold" } }),
                tray.button(showAddForm.get() ? "Cancel" : "+ Add Provider", {
                    intent: showAddForm.get() ? "alert" : "primary",
                    size: "sm",
                    onClick: ctx.eventHandler("toggle-add-form", () => {
                        showAddForm.set(!showAddForm.get())
                        tray.update()
                    })
                })
            ], { direction: "row", gap: 2, style: { justifyContent: "space-between" } })

            // Status alert
            const statusAlert = status.get() ? tray.alert({
                description: status.get(),
                intent: status.get().startsWith("Error") ? "alert" : "success"
            }) : []

            // Add provider form
            const addForm = showAddForm.get() ? tray.div([
                tray.stack([
                    tray.text("Add New Provider", { style: { fontSize: "18px", fontWeight: "600" } }),
                    tray.input({ placeholder: "Provider Name (e.g., My RealDebrid)", fieldRef: newProviderName }),
                    tray.select("Type", {
                        fieldRef: newProviderType,
                        options: [
                            { value: "realdebrid", label: "RealDebrid" },
                            { value: "torbox", label: "Torbox" },
                            { value: "alldebrid", label: "AllDebrid" },
                            { value: "premiumize", label: "Premiumize" }
                        ]
                    }),
                    tray.input({ placeholder: "API Key", fieldRef: newProviderApiKey }),
                    tray.button("Add Provider", {
                        intent: "primary",
                        onClick: ctx.eventHandler("add-provider", addProvider)
                    })
                ], { gap: 3 })
            ], { style: { border: "1px solid #444", borderRadius: "8px", padding: "12px" } }) : []

            // Provider list
            const providerList = providerKeys.length === 0
                ? tray.text("No providers configured. Add one to get started.", { style: { color: "#888" } })
                : tray.stack([
                    tray.text("Providers", { style: { fontSize: "18px", fontWeight: "600", marginTop: "8px" } }),
                    tray.stack(
                        providerKeys.map((key) => {
                            const provider = currentProviders[key]
                            const isActive = activeProvider.get() === provider.name

                            return tray.div([
                                tray.flex([
                                    tray.stack([
                                        tray.flex([
                                            tray.text(provider.name, { style: { fontWeight: "600", fontSize: "16px" } }),
                                            tray.badge(provider.type, { intent: "gray" }),
                                            isActive ? tray.badge("Active", { intent: "success" }) : []
                                        ], { direction: "row", gap: 2 }),
                                        tray.text("API Key: " + provider.apiKey.substring(0, 8) + "...", { style: { fontSize: "14px", color: "#888" } })
                                    ], { gap: 1 }),
                                    tray.flex([
                                        !isActive ? tray.button("Activate", {
                                            intent: "primary",
                                            size: "sm",
                                            onClick: ctx.eventHandler("activate-" + provider.name, () => {
                                                setDebridProvider(provider)
                                                tray.update()
                                            })
                                        }) : [],
                                        tray.button("Delete", {
                                            intent: "alert",
                                            size: "sm",
                                            onClick: ctx.eventHandler("delete-" + provider.name, () => {
                                                deleteProvider(provider.name)
                                                tray.update()
                                            })
                                        })
                                    ], { direction: "row", gap: 2 })
                                ], { direction: "row", gap: 2, style: { justifyContent: "space-between" } })
                            ], {
                                style: {
                                    border: isActive ? "2px solid #3b82f6" : "1px solid #444",
                                    borderRadius: "8px",
                                    backgroundColor: isActive ? "rgba(59, 130, 246, 0.1)" : "transparent",
                                    padding: "12px"
                                }
                            })
                        }),
                        { gap: 2 }
                    )
                ], { gap: 2 })

            return tray.div([
                tray.stack([header, statusAlert, addForm, providerList], { gap: 4 })
            ], { style: { padding: "16px" } })
        })

        // Show initial status if there's an active provider
        if (activeProvider.get()) {
            status.set("✓ Active: " + activeProvider.get())
        }
    })
}