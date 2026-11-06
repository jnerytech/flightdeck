# Host page: See all sessions leaves the saved filter alone; the host cards' cost (issue #207)

- **See all sessions** used to save `{...hubFilter(), host}`, overwriting the person's own Sessions filter with a host name. The route
  now carries the host and the hub applies it to the filter of that visit only. While it comes from the route, saving another filter
  (a toggle, a persona) keeps the saved host as it was; picking a host in the filters is the person's choice and is saved as before.
- **The host cards' week** ends on `store.today()` (the injected clock) instead of `localDay(Date.now())`, and a host that is not
  online keeps no figure: the cost is asked again when it comes back, instead of showing the old one meanwhile.
