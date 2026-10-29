def dispatch(method, path, body, config):
    if method == "POST" and path == "/v2/offers":
        return 200, {"nights": body.get("nights", config["offers_v2"]["default_nights"])}
    return 404, {"error": "not found"}
