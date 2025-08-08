'use strict';

const axios = require('axios');
const USAGE_COLLECTION_NAME = 'ai_usage_stats';
const EXCHANGE_RATES_COLLECTION_NAME = 'exchange_rates';

async function getExchangeRate(ctx) {
  const targetCurrency = ctx.settings.ai_llm_exchangerate_api_currency;
  if (!targetCurrency) {
    return null;
  }

  const exchangeRatesCollection = ctx.store.collection(EXCHANGE_RATES_COLLECTION_NAME);
  const apiKey = ctx.settings.ai_llm_exchangerate_api_key;
  const pollingIntervalDays = ctx.settings.ai_llm_exchangerate_api_poling_intervall || 7;
  const monthlyLimit = ctx.settings.ai_llm_exchangerate_api_limit || 100;

  const lastRate = await exchangeRatesCollection.findOne({}, { sort: { last_fetched: -1 } });

  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;
  let needsFetch = true;
  let usageCount = 0;
  let lastFetchMonth = -1;

  if (lastRate) {
    const lastFetchDate = new Date(lastRate.last_fetched);
    lastFetchMonth = lastFetchDate.getUTCMonth();
    const diffDays = Math.round(Math.abs((now - lastFetchDate) / oneDay));
    if (diffDays < pollingIntervalDays) {
      needsFetch = false;
    }
    usageCount = lastRate.monthly_usage_count || 0;
  }

  const currentMonth = now.getUTCMonth();
  if (lastFetchMonth !== currentMonth) {
    usageCount = 0; // Reset monthly usage count
  }

  if (needsFetch && usageCount < monthlyLimit) {
    try {
      const response = await axios.get(`https://api.exchangerate.host/latest`, {
        params: {
          base: 'USD',
          symbols: targetCurrency,
          access_key: apiKey
        }
      });

      if (response.data && response.data.success) {
        const rate = response.data.rates[targetCurrency];
        if (rate) {
          const newRateRecord = {
            base_currency: 'USD',
            target_currency: targetCurrency,
            rate: rate,
            last_fetched: now,
            monthly_usage_count: usageCount + 1
          };
          await exchangeRatesCollection.insertOne(newRateRecord);
          return { rate, currency: targetCurrency };
        }
      }
    } catch (error) {
      console.error('Error fetching exchange rate:', error.message);
      // Fallback to last known rate if API fails
    }
  }

  if (lastRate) {
    return { rate: lastRate.rate, currency: lastRate.target_currency };
  }

  return null;
}

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
      const exchangeRateInfo = await getExchangeRate(ctx);

      const cost_input = ctx.settings.ai_llm_1k_token_costs_input;
      const cost_output = ctx.settings.ai_llm_1k_token_costs_output;

      let monthlyPipeline = [
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
          $addFields: {
            total_costs: {
              $add: [
                { $multiply: [{ $divide: ["$total_prompt_tokens", 1000] }, cost_input] },
                { $multiply: [{ $divide: ["$total_completion_tokens", 1000] }, cost_output] }
              ]
            }
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
            avg_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_tokens", "$total_days_requested"] } } },

            total_costs: 1,
            avg_costs_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_costs", "$requests"] } } },
            avg_costs_per_day_requested: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_costs", "$total_days_requested"] } } }
          }
        },
        {
          $sort: { month: -1 }
        }
      ];

      if (exchangeRateInfo) {
        monthlyPipeline.push({
          $addFields: {
            [`total_costs_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$total_costs", exchangeRateInfo.rate] },
            [`avg_costs_per_request_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$avg_costs_per_request", exchangeRateInfo.rate] },
            [`avg_costs_per_day_requested_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$avg_costs_per_day_requested", exchangeRateInfo.rate] }
          }
        });
      }

      let totalPipeline = [
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
            $addFields: {
                total_costs: {
                    $add: [
                        { $multiply: [{ $divide: ["$total_prompt_tokens", 1000] }, cost_input] },
                        { $multiply: [{ $divide: ["$total_completion_tokens", 1000] }, cost_output] }
                    ]
                }
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
            avg_tokens_per_day: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_tokens", "$total_days_requested"] } } },

            total_costs: 1,
            avg_costs_per_request: { $cond: { if: { $eq: ["$requests", 0] }, then: 0, else: { $divide: ["$total_costs", "$requests"] } } },
            avg_costs_per_day_requested: { $cond: { if: { $eq: ["$total_days_requested", 0] }, then: 0, else: { $divide: ["$total_costs", "$total_days_requested"] } } }
          }
        }
      ];

      if (exchangeRateInfo) {
        totalPipeline.push({
          $addFields: {
            [`total_costs_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$total_costs", exchangeRateInfo.rate] },
            [`avg_costs_per_request_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$avg_costs_per_request", exchangeRateInfo.rate] },
            [`avg_costs_per_day_requested_${exchangeRateInfo.currency.toLowerCase()}`]: { $multiply: ["$avg_costs_per_day_requested", exchangeRateInfo.rate] }
          }
        });
      }

      const monthlyData = await usageCollection.aggregate(monthlyPipeline).toArray();
      const totalData = await usageCollection.aggregate(totalPipeline).toArray();

      res.json({
        monthly: monthlyData,
        total: totalData[0] || {},
        exchangeRateInfo: exchangeRateInfo
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
