"""路况 / 路口预载（Live）。在此实现 PgTrafficRepository。"""

from app.shared.errors import not_implemented


class TrafficService:
    def load_intersection(self, _payload: dict):
        raise not_implemented("traffic")

    def color_links(self):
        raise not_implemented("traffic")
