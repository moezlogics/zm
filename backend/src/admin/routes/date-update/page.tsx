import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Calendar, MagnifyingGlass, Spinner } from "@medusajs/icons"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Table,
  Checkbox,
  toast,
  Badge,
} from "@medusajs/ui"
import { useEffect, useState, useMemo } from "react"

type Product = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  created_at: string
  updated_at: string
}

const PAGE_SIZE = 15

const DateUpdatePage = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [count, setCount] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Fetch products
  const fetchProducts = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
        fields: "id,title,handle,thumbnail,created_at,updated_at",
      })
      if (searchQuery.trim()) {
        params.append("q", searchQuery.trim())
      }
      
      const res = await fetch(`/admin/products?${params.toString()}`, {
        credentials: "include",
      })

      if (!res.ok) {
        throw new Error(await res.text())
      }

      const data = await res.json()
      setProducts(data.products || [])
      setCount(data.count || 0)
    } catch (e: any) {
      toast.error("Failed to load products: " + (e.message || String(e)))
    } finally {
      setLoading(false)
    }
  }

  // Reload products when page or search query changes
  useEffect(() => {
    fetchProducts()
  }, [pageIndex, searchQuery])

  // Reset page index on search
  const handleSearch = (e: any) => {
    setSearchQuery(e.target.value)
    setPageIndex(0)
  }

  // Toggle selection for a product
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Determine if all visible products on the current page are selected
  const isAllPageSelected = useMemo(() => {
    if (products.length === 0) return false
    return products.every((p) => selected.has(p.id))
  }, [products, selected])

  // Toggle select all on the current page
  const toggleSelectAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (isAllPageSelected) {
        // Deselect all on current page
        products.forEach((p) => next.delete(p.id))
      } else {
        // Select all on current page
        products.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  // Handle updates
  const handleUpdate = async (selectedOnly: boolean) => {
    const targetProductCount = selectedOnly ? selected.size : count
    const confirmMessage = selectedOnly
      ? `Are you sure you want to update publication and modification timestamps for the ${targetProductCount} selected products?`
      : `Are you sure you want to update publication and modification timestamps for ALL ${count} products in the database? This operation will affect the entire catalog.`

    if (!window.confirm(confirmMessage)) return

    setUpdating(true)
    try {
      const payload = selectedOnly ? { product_ids: Array.from(selected) } : {}
      const res = await fetch("/admin/products-update-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to update product timestamps.")
      }

      const data = await res.json()
      toast.success(data.message || "Product timestamps successfully updated!")
      
      // Clear selection if we only updated selected
      if (selectedOnly) {
        setSelected(new Set())
      }

      // Reload list to see new timestamps
      await fetchProducts()
    } catch (e: any) {
      toast.error(e.message || "Failed to update product timestamps.")
    } finally {
      setUpdating(false)
    }
  }

  const pageCount = Math.ceil(count / PAGE_SIZE)
  const canNextPage = pageIndex < pageCount - 1
  const canPrevPage = pageIndex > 0

  return (
    <Container className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ui-border-base pb-4">
        <div>
          <Heading level="h1" className="flex items-center gap-2">
            <Calendar /> Product Dates Manager
          </Heading>
          <Text className="text-sm text-ui-fg-muted mt-1 max-w-2xl">
            Update `created_at` and `updated_at` publication/modification timestamps directly in the database.
            This forces search engines (Google, etc.) to crawl and re-index your products with fresh, active dates,
            substantially boosting SEO performance.
          </Text>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="secondary"
            onClick={() => handleUpdate(true)}
            disabled={selected.size === 0 || updating}
            className="flex items-center gap-2"
          >
            {updating && <Spinner className="animate-spin" />}
            Update Selected ({selected.size})
          </Button>
          <Button
            variant="primary"
            onClick={() => handleUpdate(false)}
            disabled={updating || count === 0}
            className="flex items-center gap-2"
          >
            {updating && <Spinner className="animate-spin" />}
            Update All ({count})
          </Button>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-md">
          <MagnifyingGlass className="absolute left-3 top-2.5 h-4 w-4 text-ui-fg-muted" />
          <Input
            value={searchQuery}
            onChange={handleSearch}
            placeholder="Search products by title or handle..."
            className="pl-9"
          />
        </div>
        {selected.size > 0 && (
          <Badge color="blue">
            {selected.size} product{selected.size > 1 ? "s" : ""} selected across sessions
          </Badge>
        )}
      </div>

      {/* Products Table */}
      <div className="border border-ui-border-base rounded-lg overflow-hidden bg-ui-bg-base">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-12 text-center">
                <Checkbox
                  checked={isAllPageSelected}
                  onCheckedChange={toggleSelectAllPage}
                  aria-label="Select all products on page"
                />
              </Table.HeaderCell>
              <Table.HeaderCell className="w-16">Image</Table.HeaderCell>
              <Table.HeaderCell>Product Title</Table.HeaderCell>
              <Table.HeaderCell>Handle</Table.HeaderCell>
              <Table.HeaderCell>Created At (Publication)</Table.HeaderCell>
              <Table.HeaderCell>Updated At (Modification)</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell colSpan={6} className="text-center py-12 text-ui-fg-subtle">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Spinner className="animate-spin h-6 w-6 text-ui-fg-muted" />
                    <span>Loading products...</span>
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : products.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={6} className="text-center py-12 text-ui-fg-subtle">
                  No products found.
                </Table.Cell>
              </Table.Row>
            ) : (
              products.map((p) => {
                const isSelected = selected.has(p.id)
                return (
                  <Table.Row
                    key={p.id}
                    className={`hover:bg-ui-bg-subtle transition-colors cursor-pointer ${
                      isSelected ? "bg-ui-bg-subtle" : ""
                    }`}
                    onClick={() => toggleSelect(p.id)}
                  >
                    <Table.Cell
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.title}`}
                      />
                    </Table.Cell>
                    <Table.Cell onClick={(e) => e.stopPropagation()}>
                      {p.thumbnail ? (
                        <img
                          src={p.thumbnail}
                          alt={p.title}
                          className="w-10 h-10 object-cover rounded border border-ui-border-base bg-ui-bg-subtle"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border border-ui-border-base bg-ui-bg-subtle flex items-center justify-center font-bold text-ui-fg-muted text-xs">
                          {p.title.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </Table.Cell>
                    <Table.Cell className="font-medium text-ui-fg-base">
                      {p.title}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle font-mono text-xs">
                      {p.handle}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle text-xs">
                      {new Date(p.created_at).toLocaleString()}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle text-xs">
                      {new Date(p.updated_at).toLocaleString()}
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table>

        {/* Pagination Toolbar */}
        {!loading && products.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-ui-border-base bg-ui-bg-subtle">
            <div className="text-xs text-ui-fg-muted">
              Showing <span className="font-medium">{pageIndex * PAGE_SIZE + 1}</span> to{" "}
              <span className="font-medium">
                {Math.min((pageIndex + 1) * PAGE_SIZE, count)}
              </span>{" "}
              of <span className="font-medium">{count}</span> products
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                disabled={!canPrevPage || loading}
              >
                Previous
              </Button>
              <span className="text-xs text-ui-fg-muted px-2">
                Page {pageIndex + 1} of {pageCount}
              </span>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                disabled={!canNextPage || loading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Update Dates",
  icon: Calendar,
})

export default DateUpdatePage
