'use strict';

const USAGE_COLLECTION_NAME = 'ai_usage_stats';

// This function will be called from lib/api/index.js to set up the routes
function configure(app, wares, ctx) {
  const express = require('express');
  const api = express.Router();

  api.use(wares.bodyParser.json());
  api.use(wares.sendJSONStatus);

  api.post('/record', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    const { date_from, date_till, days_requested, prompt_tokens_used, completion_tokens_used, total_tokens_used, total_api_calls } = req.body;

    if (
        !date_from ||
        !date_till ||
        typeof days_requested !== 'number' ||
        typeof prompt_tokens_used !== 'number' ||
        typeof completion_tokens_used !== 'number' ||
        typeof total_tokens_used !== 'number' ||
        typeof total_api_calls !== 'number'
    ) {
      return res.sendJSONStatus(res, 400, 'Missing or invalid fields in request body.');
    }

    try {
      const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);
      const newRecord = {
        createdAt: new Date(),
        date_from,
        date_till,
        days_requested,
        prompt_tokens_used,
        completion_tokens_used,
        total_tokens_used,
        total_api_calls,
      };

      const insertResult = await usageCollection.insertOne(newRecord);

      if (insertResult.insertedId) {
        res.json({ message: 'Usage recorded successfully.' });
      } else {
        res.sendJSONStatus(res, 500, 'Failed to record usage: DB insert not acknowledged');
      }
    } catch (error) {
      console.error('Error recording AI usage:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error recording AI usage', { details: errorMessage });
    }
  });

  api.get('/monthly_summary', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
      const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);

      const monthlyPipeline = [
        {
          $project: {
            month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            days_requested: 1,
            prompt_tokens_used: { $ifNull: ["$prompt_tokens_used", 0] },
            completion_tokens_used: { $ifNull: ["$completion_tokens_used", 0] },
            total_tokens_used: 1,
            total_api_calls: 1
          }
        },
        {
          $group: {
            _id: "$month",
            requests: { $sum: 1 },
            total_days_requested: { $sum: "$days_requested" },
            total_prompt_tokens: { $sum: "$prompt_tokens_used" },
            total_completion_tokens: { $sum: "$completion_tokens_used" },
            total_tokens: { $sum: "$total_tokens_used" }
          }
        },
        {
          $project: {
            _id: 0,
            month: "$_id",
            requests: 1,
            total_days_requested: 1,
            avg_days_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_days_requested", "$requests"] } } },

            total_prompt_tokens: 1,
            total_completion_tokens: 1,
            total_tokens: 1,

            avg_prompt_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_prompt_tokens", "$requests"] } } },
            avg_completion_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_completion_tokens", "$requests"] } } },
            avg_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_tokens", "$requests"] } } },

            avg_prompt_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_prompt_tokens", "$total_days_requested"] } } },
            avg_completion_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_completion_tokens", "$total_days_requested"] } } },
            avg_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_tokens", "$total_days_requested"] } } }
          }
        },
        {
          $sort: { month: -1 }
        }
      ];

      const totalPipeline = [
        {
          $group: {
            _id: "all_time",
            requests: { $sum: 1 },
            total_days_requested: { $sum: "$days_requested" },
            total_prompt_tokens: { $sum: { $ifNull: ["$prompt_tokens_used", 0] } },
            total_completion_tokens: { $sum: { $ifNull: ["$completion_tokens_used", 0] } },
            total_tokens: { $sum: "$total_tokens_used" }
          }
        },
        {
          $project: {
            _id: 0,
            requests: 1,
            total_days_requested: 1,
            avg_days_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_days_requested", "$requests"] } } },

            total_prompt_tokens: 1,
            total_completion_tokens: 1,
            total_tokens: 1,

            avg_prompt_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_prompt_tokens", "$requests"] } } },
            avg_completion_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_completion_tokens", "$requests"] } } },
            avg_tokens_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_tokens", "$requests"] } } },

            avg_prompt_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_prompt_tokens", "$total_days_requested"] } } },
            avg_completion_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_completion_tokens", "$total_days_requested"] } } },
            avg_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_tokens", "$total_days_requested"] } } }
          }
        }
      ];

      const monthlyData = await usageCollection.aggregate(monthlyPipeline).toArray();
      const totalData = await usageCollection.aggregate(totalPipeline).toArray();

      res.json({
        monthly: monthlyData,
        total: totalData[0] || {}
      });

    } catch (error) {
      console.error('Error fetching AI usage summary:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error fetching AI usage summary', { details: errorMessage });
    }
  });

  return api;
}

module.exports = configure;
