export class ApiFeatures {
  // Current Mongoose query we keep mutating (find -> find + skip/limit ...)
  mongooseQuery: any;

  // Raw query params (req.query)
  query: any;

  // Search state
  keyword = "";
  filter: any = {}; // Reused for countDocuments() to keep total consistent with items

  // Pagination state
  page = 1;
  limit = 10;
  skip = 0;

  constructor(mongooseQuery: any, query: any) {
    this.mongooseQuery = mongooseQuery;
    this.query = query || {};
  }

  /**
   * Applies case-insensitive search over whitelisted fields using "q".
   * Stores the applied filter so it can be reused for countDocuments().
   */
  search(fields: string[] = []) {
    const q = String(this.query.q || "").trim();
    this.keyword = q;

    if (q && fields.length) {
      // Escape regex special chars to avoid heavy patterns and injection
      const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      this.filter = {
        $or: fields.map((f) => ({ [f]: { $regex: safeQ, $options: "i" } })),
      };

      this.mongooseQuery = this.mongooseQuery.find(this.filter);
    }

    return this;
  }

  /**
   * Applies skip/limit pagination.
   * - page defaults to 1
   * - limit defaults to defaultLimit
   * - limit is capped by maxLimit
   */
  paginate(defaultLimit = 10, maxLimit = 50) {
    const page = parseInt(String(this.query.page || "1"), 10);
    const limit = parseInt(String(this.query.limit || defaultLimit), 10);

    this.page = Number.isFinite(page) && page > 0 ? page : 1;

    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : defaultLimit;
    this.limit = Math.min(safeLimit, maxLimit);

    this.skip = (this.page - 1) * this.limit;

    this.mongooseQuery = this.mongooseQuery.skip(this.skip).limit(this.limit);
    return this;
  }

  /**
   * Pagination metadata for API responses.
   */
  meta(total: number) {
    return {
      page: this.page,
      limit: this.limit,
      total,
    };
  }
}