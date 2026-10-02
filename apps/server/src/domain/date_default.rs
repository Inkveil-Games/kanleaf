use chrono::{Datelike, Days, Months, NaiveDate};
use serde::{Deserialize, Deserializer, Serialize, de::Error};

use super::ValidationError;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum DateDefault {
    Fixed {
        #[serde(deserialize_with = "deserialize_date")]
        date: NaiveDate,
    },
    Dynamic {
        amount: u32,
        unit: DateUnit,
        direction: DateDirection,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DateUnit {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DateDirection {
    Before,
    After,
}

impl DateDefault {
    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Fixed { date } if !(1..=9999).contains(&date.year()) => Err(invalid()),
            Self::Dynamic { amount, unit, .. }
                if *amount
                    > match unit {
                        DateUnit::Day => 3_652_058,
                        DateUnit::Week => 521_722,
                        DateUnit::Month => 119_987,
                        DateUnit::Year => 9_998,
                    } =>
            {
                Err(invalid())
            }
            _ => Ok(()),
        }
    }

    pub fn resolve(&self, reference: NaiveDate) -> Result<NaiveDate, ValidationError> {
        self.validate()?;
        let date = match *self {
            Self::Fixed { date } => Some(date),
            Self::Dynamic {
                amount,
                unit,
                direction,
            } => {
                let before = direction == DateDirection::Before;
                match unit {
                    DateUnit::Day | DateUnit::Week => {
                        let days = Days::new(
                            u64::from(amount) * if unit == DateUnit::Week { 7 } else { 1 },
                        );
                        if before {
                            reference.checked_sub_days(days)
                        } else {
                            reference.checked_add_days(days)
                        }
                    }
                    DateUnit::Month | DateUnit::Year => {
                        let months =
                            Months::new(amount * if unit == DateUnit::Year { 12 } else { 1 });
                        if before {
                            reference.checked_sub_months(months)
                        } else {
                            reference.checked_add_months(months)
                        }
                    }
                }
            }
        }
        .ok_or_else(invalid)?;
        if !(1..=9999).contains(&date.year()) {
            return Err(invalid());
        }
        Ok(date)
    }
}

pub fn local_reference_date(
    timestamp: jiff::Timestamp,
    timezone: &str,
) -> Result<NaiveDate, ValidationError> {
    let date = timestamp.in_tz(timezone).map_err(|_| invalid())?.date();
    NaiveDate::from_ymd_opt(
        i32::from(date.year()),
        date.month() as u32,
        date.day() as u32,
    )
    .ok_or_else(invalid)
}

fn invalid() -> ValidationError {
    ValidationError::new("Invalid or overflowing Date default")
}

fn deserialize_date<'de, D: Deserializer<'de>>(deserializer: D) -> Result<NaiveDate, D::Error> {
    let raw = String::deserialize(deserializer)?;
    let date = raw.parse::<NaiveDate>().map_err(D::Error::custom)?;
    if raw.len() != 10 || date.to_string() != raw || !(1..=9999).contains(&date.year()) {
        return Err(D::Error::custom("Date defaults require YYYY-MM-DD"));
    }
    Ok(date)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn date(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }
    #[test]
    fn calendar_offsets_clamp_and_preserve_zero() {
        for (anchor, amount, unit, direction, expected) in [
            (
                "2024-01-31",
                1,
                DateUnit::Month,
                DateDirection::After,
                "2024-02-29",
            ),
            (
                "2024-03-31",
                1,
                DateUnit::Month,
                DateDirection::Before,
                "2024-02-29",
            ),
            (
                "2024-02-29",
                1,
                DateUnit::Year,
                DateDirection::After,
                "2025-02-28",
            ),
            (
                "2024-02-29",
                1,
                DateUnit::Year,
                DateDirection::Before,
                "2023-02-28",
            ),
            (
                "2024-12-31",
                1,
                DateUnit::Day,
                DateDirection::After,
                "2025-01-01",
            ),
            (
                "2024-01-01",
                1,
                DateUnit::Week,
                DateDirection::Before,
                "2023-12-25",
            ),
            (
                "2024-02-29",
                0,
                DateUnit::Year,
                DateDirection::After,
                "2024-02-29",
            ),
        ] {
            assert_eq!(
                DateDefault::Dynamic {
                    amount,
                    unit,
                    direction
                }
                .resolve(date(anchor))
                .unwrap(),
                date(expected)
            );
        }
    }
    #[test]
    fn invalid_settings_and_calendar_overflow_fail() {
        for raw in [
            r#"{"mode":"dynamic","amount":-1,"unit":"day","direction":"after"}"#,
            r#"{"mode":"dynamic","amount":0.5,"unit":"day","direction":"after"}"#,
            r#"{"mode":"fixed","date":"2023-02-29"}"#,
            r#"{"mode":"fixed","date":"2026-2-3"}"#,
            r#"{"mode":"dynamic","amount":1,"unit":"hour","direction":"after"}"#,
        ] {
            assert!(serde_json::from_str::<DateDefault>(raw).is_err());
        }
        assert!(
            DateDefault::Dynamic {
                amount: u32::MAX,
                unit: DateUnit::Year,
                direction: DateDirection::After
            }
            .validate()
            .is_err()
        );
        assert!(
            DateDefault::Dynamic {
                amount: 1,
                unit: DateUnit::Day,
                direction: DateDirection::After
            }
            .resolve(date("9999-12-31"))
            .is_err()
        );
    }
    #[test]
    fn creator_timezone_selects_local_calendar_day() {
        let timestamp = "2026-10-03T00:30:00Z".parse().unwrap();
        assert_eq!(
            local_reference_date(timestamp, "America/Los_Angeles").unwrap(),
            date("2026-10-02")
        );
        assert_eq!(
            local_reference_date(timestamp, "Pacific/Kiritimati").unwrap(),
            date("2026-10-03")
        );
    }
}
